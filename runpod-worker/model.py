from __future__ import annotations

import io
import os
import random
import tempfile
from functools import lru_cache
from typing import Callable, Dict, List

import numpy as np
from ase import units
from ase.build import bulk
from ase.io import read
from ase.io.trajectory import Trajectory
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.optimize import BFGS, FIRE, LBFGS
from fairchem.core import FAIRChemCalculator
from fairchem.core.units.mlip_unit import load_predict_unit
from huggingface_hub import hf_hub_download
from orb_models.forcefield import pretrained
from orb_models.forcefield.calculator import ORBCalculator
from pymatgen.io.ase import AseAtomsAdaptor
from pymatgen.io.cif import CifWriter
from torch.serialization import add_safe_globals

# ----------------------------
# Config
# ----------------------------

RELAX_FMAX = float(os.getenv("RELAX_FMAX", "0.05"))
RELAX_STEPS = int(os.getenv("RELAX_STEPS", "300"))

MD_DEFAULT_TEMPERATURE_K = float(os.getenv("MD_DEFAULT_TEMPERATURE_K", "800"))
MD_DEFAULT_TIMESTEP_FS = float(os.getenv("MD_DEFAULT_TIMESTEP_FS", "1.0"))
MD_DEFAULT_TOTAL_TIME_PS = float(os.getenv("MD_DEFAULT_TOTAL_TIME_PS", "5.0"))
MD_DEFAULT_SAMPLE_EVERY = int(os.getenv("MD_DEFAULT_SAMPLE_EVERY", "10"))

DEVICE = os.getenv("ML_DEVICE", "cpu")
SUPPORTED_POTENTIALS = {"uma", "orb"}

# Explorer settings
TEMPLATE_PATH = os.getenv("TEMPLATE_PATH", "../template/Na12Mn11Zr1O24.cif")
N_CONFIGS = int(os.getenv("N_CONFIGS", "10"))
NA_REMOVED_FIXED = int(os.getenv("NA_REMOVED_FIXED", "12"))

MD_TEMP_K = float(os.getenv("EXPLORER_MD_TEMP_K", "800"))
MD_TIMESTEP_FS = float(os.getenv("EXPLORER_MD_TIMESTEP_FS", "1.0"))
MD_STEPS = int(os.getenv("EXPLORER_MD_STEPS", "5000"))
MD_SAMPLE_INTERVAL = int(os.getenv("EXPLORER_MD_SAMPLE_INTERVAL", "1"))
MD_NA_VACANCY_FRACTION = float(os.getenv("EXPLORER_MD_NA_VACANCY_FRACTION", "0.25"))
MD_LOG_INTERVAL = int(os.getenv("EXPLORER_MD_LOG_INTERVAL", "100"))


# ----------------------------
# Helpers
# ----------------------------

def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_potential(potential: str) -> str:
    value = (potential or "uma").lower().strip()
    if value not in SUPPORTED_POTENTIALS:
        raise ValueError(
            f"Unsupported potential '{potential}'. Choose one of: {sorted(SUPPORTED_POTENTIALS)}"
        )
    return value


def atoms_to_cif_string(atoms) -> str:
    structure = AseAtomsAdaptor.get_structure(atoms)
    return str(CifWriter(structure))


def cif_string_to_atoms(cif_text: str):
    if not cif_text or not cif_text.strip():
        raise ValueError("CIF input is empty")
    return read(io.StringIO(cif_text), format="cif")


def uploaded_file_to_atoms(filename: str, file_bytes: bytes):
    suffix = os.path.splitext(filename)[1] or ".tmp"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        atoms = read(tmp_path)
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    return atoms


def get_optimizer(name: str, atoms, logfile: str = "-"):
    key = (name or "LBFGS").upper()

    if key == "LBFGS":
        return LBFGS(atoms, logfile=logfile)
    if key == "BFGS":
        return BFGS(atoms, logfile=logfile)
    if key == "FIRE":
        return FIRE(atoms, logfile=logfile)

    raise ValueError(f"Unsupported optimizer '{name}'")


def validate_positive_float(name: str, value) -> float:
    try:
        value = float(value)
    except Exception as exc:
        raise ValueError(f"{name} must be a number") from exc

    if value <= 0:
        raise ValueError(f"{name} must be > 0")

    return value


def validate_positive_int(name: str, value) -> int:
    try:
        value = int(value)
    except Exception as exc:
        raise ValueError(f"{name} must be an integer") from exc

    if value <= 0:
        raise ValueError(f"{name} must be > 0")

    return value


def steps_from_md_params(total_time_ps: float, timestep_fs: float) -> int:
    total_time_ps = validate_positive_float("total_time_ps", total_time_ps)
    timestep_fs = validate_positive_float("timestep_fs", timestep_fs)
    return max(1, int(round((total_time_ps * 1000.0) / timestep_fs)))


def default_md_friction(potential: str) -> float:
    potential = normalize_potential(potential)
    return 0.01 if potential == "uma" else 0.02


def compute_species_msd(
    atoms,
    initial_positions: np.ndarray,
    species: list[str],
) -> dict[str, float]:
    current_positions = atoms.get_positions()
    displacements = current_positions - initial_positions
    sq_disp = np.sum(displacements ** 2, axis=1)

    chem_symbols = np.array(atoms.get_chemical_symbols())
    msd_by_species: dict[str, float] = {}

    for sp in species:
        mask = chem_symbols == sp
        if np.any(mask):
            msd_by_species[sp] = float(np.mean(sq_disp[mask]))
        else:
            msd_by_species[sp] = 0.0

    return msd_by_species


def md_friction_for_potential(potential: str) -> float:
    return 0.02 if normalize_potential(potential) == "orb" else 0.01


def relax_ase(atoms, calc, fmax=RELAX_FMAX, steps=RELAX_STEPS, label="relaxation") -> float:
    log(f"[RELAX] Starting {label} (fmax={fmax}, steps={steps})")
    atoms.calc = calc
    dyn = LBFGS(atoms, logfile="-")
    dyn.run(fmax=fmax, steps=steps)
    energy = float(atoms.get_potential_energy())
    log(f"[RELAX] Finished {label} | Energy = {energy:.6f} eV")
    return energy


# ----------------------------
# ML calculators
# ----------------------------

@lru_cache(maxsize=1)
def get_uma_calc():
    log("[INIT] Loading UMA calculator...")
    add_safe_globals([slice])

    checkpoint = hf_hub_download(
        repo_id="facebook/UMA",
        filename="uma-s-1p1.pt",
        subfolder="checkpoints",
    )

    predictor = load_predict_unit(
        checkpoint,
        inference_settings="default",
        device=DEVICE,
    )

    log("[INIT] UMA calculator ready")
    return FAIRChemCalculator(predictor, task_name="omat")


@lru_cache(maxsize=1)
def get_orb_calc():
    log("[INIT] Loading ORB calculator...")
    orbff = pretrained.orb_v3_conservative_inf_omat(
        device=DEVICE,
        precision="float32-high",
    )
    log("[INIT] ORB calculator ready")
    return ORBCalculator(orbff, device=DEVICE)


def get_calc(potential: str):
    potential = normalize_potential(potential)

    if potential == "uma":
        return get_uma_calc()
    if potential == "orb":
        return get_orb_calc()

    raise ValueError(f"Unsupported potential '{potential}'")


# ----------------------------
# Structure preview
# ----------------------------

def preview_structure(filename: str, file_bytes: bytes) -> dict:
    atoms = uploaded_file_to_atoms(filename, file_bytes)
    cif = atoms_to_cif_string(atoms)

    return {
        "filename": filename,
        "n_atoms": len(atoms),
        "cif": cif,
    }


# ----------------------------
# Upload relaxation
# ----------------------------

def run_relaxation_stream(
    filename: str,
    file_bytes: bytes,
    potential: str = "uma",
    optimizer: str = "LBFGS",
    fmax: float = RELAX_FMAX,
    steps: int = RELAX_STEPS,
):
    potential = normalize_potential(potential)
    fmax = validate_positive_float("fmax", fmax)
    steps = validate_positive_int("steps", steps)

    calc = get_calc(potential)

    log(f"[RELAX] Loading structure from {filename}")
    atoms = uploaded_file_to_atoms(filename, file_bytes)

    atoms.calc = calc
    initial_cif = atoms_to_cif_string(atoms)
    initial_energy = float(atoms.get_potential_energy())

    yield {
        "event": "meta",
        "filename": filename,
        "potential": potential,
        "optimizer": optimizer,
        "n_atoms": len(atoms),
        "initial_cif": initial_cif,
        "initial_energy": initial_energy,
    }

    traj_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".traj")
    traj_tmp.close()
    traj_path = traj_tmp.name

    traj = Trajectory(traj_path, "w", atoms)
    dyn = get_optimizer(optimizer, atoms, logfile="-")

    converged = False

    try:
        for step in range(steps):
            dyn.run(fmax=fmax, steps=1)
            traj.write(atoms)

            energy = float(atoms.get_potential_energy())
            forces = atoms.get_forces()
            max_force = float(np.abs(forces).max()) if len(forces) else 0.0

            log_line = (
                f"step {step + 1}/{steps} | "
                f"E = {energy:.6f} eV | "
                f"max|F| = {max_force:.4f} eV/A"
            )

            yield {
                "event": "progress",
                "step": step + 1,
                "steps": steps,
                "energy": energy,
                "max_force": max_force,
                "progress": float(step + 1) / float(steps),
                "log_line": log_line,
            }

            if max_force <= fmax:
                converged = True
                break
    finally:
        try:
            traj.close()
        except Exception:
            pass

    final_energy = float(atoms.get_potential_energy())
    relaxed_cif = atoms_to_cif_string(atoms)

    yield {
        "event": "result",
        "filename": filename,
        "potential": potential,
        "optimizer": optimizer,
        "n_atoms": len(atoms),
        "initial_energy": initial_energy,
        "final_energy": final_energy,
        "relaxed_cif": relaxed_cif,
        "traj_path": traj_path,
        "converged": converged,
    }


# ----------------------------
# Upload NVT MD
# ----------------------------

def run_nvt_md_stream(
    filename: str,
    file_bytes: bytes,
    potential: str = "uma",
    temperature_k: float = MD_DEFAULT_TEMPERATURE_K,
    timestep_fs: float = MD_DEFAULT_TIMESTEP_FS,
    total_time_ps: float = MD_DEFAULT_TOTAL_TIME_PS,
    friction: float | None = None,
    sample_every: int = MD_DEFAULT_SAMPLE_EVERY,
    cancel_check: Callable[[], bool] | None = None,
):
    potential = normalize_potential(potential)
    temperature_k = validate_positive_float("temperature_k", temperature_k)
    timestep_fs = validate_positive_float("timestep_fs", timestep_fs)
    total_time_ps = validate_positive_float("total_time_ps", total_time_ps)
    sample_every = validate_positive_int("sample_every", sample_every)

    if friction is None:
        friction = default_md_friction(potential)
    friction = validate_positive_float("friction", friction)

    steps = steps_from_md_params(total_time_ps=total_time_ps, timestep_fs=timestep_fs)
    calc = get_calc(potential)

    log(f"[MD] Loading structure from {filename}")
    atoms = uploaded_file_to_atoms(filename, file_bytes)
    atoms.calc = calc

    n_atoms = len(atoms)
    initial_cif = atoms_to_cif_string(atoms)
    species = sorted(set(atoms.get_chemical_symbols()))
    initial_positions = atoms.get_positions().copy()

    MaxwellBoltzmannDistribution(atoms, temperature_K=temperature_k)

    traj_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".traj")
    traj_tmp.close()
    traj_path = traj_tmp.name

    traj = Trajectory(traj_path, "w", atoms)

    dyn = Langevin(
        atoms,
        timestep=timestep_fs * units.fs,
        temperature_K=temperature_k,
        friction=friction,
    )

    yield {
        "event": "meta",
        "filename": filename,
        "potential": potential,
        "n_atoms": n_atoms,
        "temperature_k": temperature_k,
        "timestep_fs": timestep_fs,
        "total_time_ps": total_time_ps,
        "steps": steps,
        "friction": friction,
        "species": species,
        "initial_cif": initial_cif,
    }

    try:
        for step in range(1, steps + 1):
            if cancel_check is not None and cancel_check():
                yield {
                    "event": "cancelled",
                    "filename": filename,
                    "potential": potential,
                    "message": "MD cancelled by user.",
                    "step": step,
                    "steps": steps,
                }
                return

            dyn.run(1)
            traj.write(atoms)

            should_emit = (step == 1) or (step % sample_every == 0) or (step == steps)
            if not should_emit:
                continue

            epot = float(atoms.get_potential_energy())
            ekin = float(atoms.get_kinetic_energy())
            time_ps = step * timestep_fs / 1000.0
            msd_by_species = compute_species_msd(
                atoms=atoms,
                initial_positions=initial_positions,
                species=species,
            )

            log_line = (
                f"step {step}/{steps} | "
                f"t = {time_ps:.4f} ps | "
                f"Epot = {epot:.6f} eV | "
                f"Ekin = {ekin:.6f} eV"
            )

            yield {
                "event": "progress",
                "step": step,
                "steps": steps,
                "progress": float(step) / float(steps),
                "time_ps": time_ps,
                "potential_energy": epot,
                "kinetic_energy": ekin,
                "temperature_k": temperature_k,
                "msd_by_species": msd_by_species,
                "log_line": log_line,
            }

    finally:
        try:
            traj.close()
        except Exception:
            pass

    final_cif = atoms_to_cif_string(atoms)
    final_epot = float(atoms.get_potential_energy())
    final_ekin = float(atoms.get_kinetic_energy())

    yield {
        "event": "result",
        "filename": filename,
        "potential": potential,
        "n_atoms": n_atoms,
        "temperature_k": temperature_k,
        "timestep_fs": timestep_fs,
        "total_time_ps": total_time_ps,
        "steps": steps,
        "friction": friction,
        "final_cif": final_cif,
        "traj_path": traj_path,
        "final_potential_energy": final_epot,
        "final_kinetic_energy": final_ekin,
    }


# ----------------------------
# Explorer / screening helpers
# ----------------------------

def compute_voltage(E_sod, E_desod, mu_na, n_removed=NA_REMOVED_FIXED) -> float:
    return (E_desod - E_sod + n_removed * mu_na) / n_removed


@lru_cache(maxsize=None)
def get_mu_na(potential: str) -> float:
    potential = normalize_potential(potential)
    calc = get_calc(potential)

    na_bulk = bulk("Na", "bcc", a=4.23)
    na_bulk.calc = calc
    E = float(na_bulk.get_potential_energy())
    return E / len(na_bulk)


def validate_fractions(
    transition_metals: list[str],
    dopants: list[str],
    fractions: dict[str, float],
):
    allowed = set(transition_metals) | set(dopants)

    if not fractions:
        raise ValueError("fractions dictionary is empty")

    fraction_keys = set(fractions.keys())
    if fraction_keys != allowed:
        missing = sorted(allowed - fraction_keys)
        extra = sorted(fraction_keys - allowed)
        pieces = []
        if missing:
            pieces.append(f"missing keys: {missing}")
        if extra:
            pieces.append(f"unexpected keys: {extra}")
        raise ValueError(
            "fractions keys must match selected TM + dopants exactly; " + ", ".join(pieces)
        )

    total = 0.0
    positive_count = 0

    for el, value in fractions.items():
        try:
            v = float(value)
        except Exception:
            raise ValueError(f"Fraction for {el} is not a valid number")

        if v < 0 or v > 1:
            raise ValueError(f"Fraction for {el} must be between 0 and 1")

        if v > 0:
            positive_count += 1

        total += v

    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"TM + dopant fractions must sum to 1. Current sum = {total:.6f}")

    if positive_count == 0:
        raise ValueError("At least one fraction must be > 0")


def fractions_to_counts(fractions: dict[str, float], total_sites: int):
    items = list(fractions.items())

    raw = [(el, float(frac) * total_sites) for el, frac in items]
    base = [(el, int(val)) for el, val in raw]

    counts = {el: c for el, c in base}
    used = sum(counts.values())
    remainder = total_sites - used

    remainders = sorted(
        [(el, raw_val - int(raw_val)) for el, raw_val in raw],
        key=lambda x: x[1],
        reverse=True,
    )

    for i in range(remainder):
        el = remainders[i][0]
        counts[el] += 1

    return counts


def counts_to_species_list(counts: dict[str, int]):
    species = []
    for el, count in counts.items():
        species.extend([el] * int(count))
    return species


def generate_unique_config_signatures(counts, n_configs=10, max_attempts=2000):
    base_species = counts_to_species_list(counts)

    if len(base_species) == 0:
        raise ValueError("No species generated from counts")

    seen = set()
    signatures = []

    attempts = 0
    while len(signatures) < n_configs and attempts < max_attempts:
        attempts += 1
        trial = base_species.copy()
        random.shuffle(trial)
        key = tuple(trial)
        if key in seen:
            continue
        seen.add(key)
        signatures.append(trial)

    if len(signatures) == 0:
        raise ValueError("Could not generate any configuration signatures")

    return signatures


def apply_signature_to_atoms(template_atoms, tm_indices, signature):
    atoms = template_atoms.copy()
    for idx, symbol in zip(tm_indices, signature):
        atoms[idx].symbol = symbol
    return atoms


def summarize_species(counts, transition_metals, dopants):
    tm_species = {el: int(counts[el]) for el in transition_metals if counts.get(el, 0) > 0}
    dopant_species = {el: int(counts[el]) for el in dopants if counts.get(el, 0) > 0}

    chosen_tm = ", ".join(f"{el}{tm_species[el]}" for el in tm_species) if tm_species else "—"
    chosen_dopant = ", ".join(f"{el}{dopant_species[el]}" for el in dopant_species) if dopant_species else "—"

    return tm_species, dopant_species, chosen_tm, chosen_dopant


def create_random_na_vacancies(atoms, vacancy_fraction=MD_NA_VACANCY_FRACTION):
    atoms_vac = atoms.copy()
    na_indices = [i for i, a in enumerate(atoms_vac) if a.symbol == "Na"]

    if len(na_indices) == 0:
        raise ValueError("No Na atoms found for vacancy creation")

    n_remove = max(1, int(round(vacancy_fraction * len(na_indices))))
    remove_indices = random.sample(na_indices, n_remove)

    for idx in sorted(remove_indices, reverse=True):
        del atoms_vac[idx]

    return atoms_vac, n_remove


# ----------------------------
# Explorer screening
# ----------------------------

def run_screening_stream(
    transition_metals,
    dopants,
    fractions,
    potential="uma",
):
    if not transition_metals:
        raise ValueError("transition_metals list is empty")
    if not dopants:
        raise ValueError("dopants list is empty")

    potential = normalize_potential(potential)

    yield {
        "event": "status",
        "message": f"Initializing {potential.upper()} calculator...",
        "progress": 0.02,
    }

    calc = get_calc(potential)

    validate_fractions(
        transition_metals=transition_metals,
        dopants=dopants,
        fractions=fractions,
    )

    yield {
        "event": "status",
        "message": "Fractions validated",
        "progress": 0.06,
    }

    if not os.path.exists(TEMPLATE_PATH):
        raise ValueError(f"Template CIF not found at {TEMPLATE_PATH}")

    template_atoms = read(TEMPLATE_PATH)

    tm_indices = [i for i, a in enumerate(template_atoms) if a.symbol in ["Mn", "Zr"]]
    if len(tm_indices) != 12:
        raise ValueError(f"Expected 12 TM sites (Mn/Zr), found {len(tm_indices)}")

    total_tm_sites = len(tm_indices)
    counts = fractions_to_counts(fractions, total_tm_sites)

    yield {
        "event": "status",
        "message": "Generating unique configurations...",
        "progress": 0.10,
        "site_counts": counts,
    }

    signatures = generate_unique_config_signatures(counts, n_configs=N_CONFIGS)

    configuration_energies = []
    relaxed_candidates = []
    candidate_cif_doped = []

    total_relax_units = len(signatures) + 1
    relax_block_start = 0.12
    relax_block_end = 0.90
    relax_block_span = relax_block_end - relax_block_start

    for i, signature in enumerate(signatures, start=1):
        atoms_candidate = apply_signature_to_atoms(template_atoms, tm_indices, signature)
        cif_doped = atoms_to_cif_string(atoms_candidate)

        yield {
            "event": "progress",
            "message": f"Relaxing configuration {i}/{len(signatures)}...",
            "stage": "configuration_relaxation",
            "config_index": i,
            "config_total": len(signatures),
            "progress": relax_block_start + relax_block_span * ((i - 1) / total_relax_units),
        }

        E_sod = relax_ase(
            atoms_candidate,
            calc=calc,
            label=f"sodiated configuration {i}",
        )

        configuration_energies.append(
            {
                "name": f"Configuration {i}",
                "index": i,
                "energy": round(float(E_sod), 6),
            }
        )
        relaxed_candidates.append((atoms_candidate.copy(), float(E_sod)))
        candidate_cif_doped.append(cif_doped)

        yield {
            "event": "config_done",
            "message": f"Finished configuration {i}/{len(signatures)}",
            "stage": "configuration_relaxation",
            "config_index": i,
            "config_total": len(signatures),
            "energy": round(float(E_sod), 6),
            "configuration_energies": configuration_energies,
            "progress": relax_block_start + relax_block_span * (i / total_relax_units),
        }

    selected_idx = min(range(len(relaxed_candidates)), key=lambda k: relaxed_candidates[k][1])
    selected_config_number = selected_idx + 1

    atoms_sod = relaxed_candidates[selected_idx][0]
    E_sod = float(relaxed_candidates[selected_idx][1])

    cif_doped = candidate_cif_doped[selected_idx]
    cif_sodiated_relaxed = atoms_to_cif_string(atoms_sod)

    yield {
        "event": "status",
        "message": f"Selected lowest-energy configuration: {selected_config_number}",
        "selected_configuration": {
            "name": f"Configuration {selected_config_number}",
            "index": selected_config_number,
            "energy": round(float(E_sod), 6),
        },
        "progress": 0.92,
    }

    atoms_des = atoms_sod.copy()
    na_indices = [i for i, a in enumerate(atoms_des) if a.symbol == "Na"]

    if len(na_indices) < NA_REMOVED_FIXED:
        raise ValueError(
            f"Structure has only {len(na_indices)} Na, cannot remove {NA_REMOVED_FIXED}"
        )

    for idx in sorted(na_indices[:NA_REMOVED_FIXED], reverse=True):
        del atoms_des[idx]

    yield {
        "event": "progress",
        "message": "Relaxing desodiated selected configuration...",
        "stage": "desodiated_relaxation",
        "progress": 0.94,
    }

    E_desod = relax_ase(
        atoms_des,
        calc=calc,
        label="selected desodiated configuration",
    )
    cif_desodiated_relaxed = atoms_to_cif_string(atoms_des)

    yield {
        "event": "status",
        "message": "Computing Na reference and voltage...",
        "progress": 0.97,
    }

    mu_na = float(get_mu_na(potential))
    V = compute_voltage(E_sod, E_desod, mu_na, n_removed=NA_REMOVED_FIXED)

    nonzero_species = {el: float(frac) for el, frac in fractions.items() if float(frac) > 0}
    tm_species, dopant_species, chosen_tm, chosen_dopant = summarize_species(
        counts, transition_metals, dopants
    )

    result = {
        "potential": potential,
        "n_configurations": len(configuration_energies),
        "configuration_energies": configuration_energies,
        "selected_configuration": {
            "name": f"Configuration {selected_config_number}",
            "index": selected_config_number,
            "energy": round(float(E_sod), 6),
        },
        "chosen_tm": chosen_tm,
        "chosen_dopant": chosen_dopant,
        "tm_sites": int(sum(tm_species.values())),
        "dopant_sites": int(sum(dopant_species.values())),
        "na_removed": int(NA_REMOVED_FIXED),
        "mu_na": float(mu_na),
        "sodiated_energy": float(E_sod),
        "desodiated_energy": float(E_desod),
        "voltage": round(float(V), 3),
        "composition": nonzero_species,
        "site_counts": counts,
        "cif_doped": cif_doped,
        "cif_sodiated_relaxed": cif_sodiated_relaxed,
        "cif_desodiated_relaxed": cif_desodiated_relaxed,
    }

    yield {
        "event": "result",
        "message": "Screening completed",
        "progress": 1.0,
        **result,
    }


def run_screening(transition_metals, dopants, fractions, potential="uma"):
    final_result = None
    for item in run_screening_stream(
        transition_metals=transition_metals,
        dopants=dopants,
        fractions=fractions,
        potential=potential,
    ):
        if item.get("event") == "result":
            final_result = {
                k: v for k, v in item.items()
                if k not in {"event", "message", "progress"}
            }

    if final_result is None:
        raise RuntimeError("Screening did not produce a final result")

    return final_result


# ----------------------------
# Explorer MD
# ----------------------------

def run_md_stream(
    cif: str,
    potential="uma",
    should_stop: Callable[[], bool] | None = None,
):
    potential = normalize_potential(potential)
    should_stop = should_stop or (lambda: False)
    calc = get_calc(potential)

    def cancelled_payload(message: str, **extra):
        return {
            "event": "cancelled",
            "message": message,
            "potential": potential,
            **extra,
        }

    if should_stop():
        yield cancelled_payload("MD cancelled before structure loading")
        return

    atoms = cif_string_to_atoms(cif)

    yield {
        "event": "status",
        "message": "Loaded selected structure for MD",
        "potential": potential,
    }

    if should_stop():
        yield cancelled_payload("MD cancelled before vacancy creation")
        return

    atoms_md_seed, md_na_removed = create_random_na_vacancies(
        atoms,
        vacancy_fraction=MD_NA_VACANCY_FRACTION,
    )

    yield {
        "event": "status",
        "message": "Created random 25% Na vacancies",
        "na_removed_for_md": int(md_na_removed),
        "na_vacancy_fraction": MD_NA_VACANCY_FRACTION,
    }

    atoms_md = atoms_md_seed.copy()
    atoms_md.calc = calc

    if should_stop():
        yield cancelled_payload(
            "MD cancelled before pre-relaxation",
            na_removed_for_md=int(md_na_removed),
            na_vacancy_fraction=MD_NA_VACANCY_FRACTION,
        )
        return

    yield {
        "event": "status",
        "message": "Starting MD pre-relaxation",
    }

    relax_ase(atoms_md, calc=calc, fmax=0.05, steps=120, label="MD pre-relaxation")

    cif_md_start = atoms_to_cif_string(atoms_md)

    yield {
        "event": "status",
        "message": "MD pre-relaxation finished",
        "cif_md_start": cif_md_start,
    }

    if should_stop():
        yield cancelled_payload(
            "MD cancelled after pre-relaxation",
            cif_md_start=cif_md_start,
            na_removed_for_md=int(md_na_removed),
            na_vacancy_fraction=MD_NA_VACANCY_FRACTION,
        )
        return

    MaxwellBoltzmannDistribution(atoms_md, temperature_K=MD_TEMP_K)

    dyn = Langevin(
        atoms_md,
        timestep=MD_TIMESTEP_FS * units.fs,
        temperature_K=MD_TEMP_K,
        friction=md_friction_for_potential(potential),
    )

    pbc = atoms_md.get_pbc()
    cell = np.array(atoms_md.get_cell())

    ref_scaled = atoms_md.get_scaled_positions(wrap=True)
    prev_scaled = ref_scaled.copy()
    cumulative_frac = np.zeros_like(ref_scaled)

    na_mask = np.array([a.symbol == "Na" for a in atoms_md], dtype=bool)
    non_na_mask = ~na_mask

    temp_series_k = []

    yield {
        "event": "meta",
        "potential": potential,
        "temperature_k": MD_TEMP_K,
        "timestep_fs": MD_TIMESTEP_FS,
        "steps": MD_STEPS,
        "sample_interval": MD_SAMPLE_INTERVAL,
        "total_time_ps": MD_STEPS * MD_TIMESTEP_FS / 1000.0,
        "n_atoms": len(atoms_md),
        "n_na_atoms": int(np.sum(na_mask)),
        "n_non_na_atoms": int(np.sum(non_na_mask)),
        "na_vacancy_fraction": MD_NA_VACANCY_FRACTION,
        "na_removed_for_md": int(md_na_removed),
        "cif_md_start": cif_md_start,
    }

    for step in range(1, MD_STEPS + 1):
        if should_stop():
            avg_temp = float(np.mean(temp_series_k)) if temp_series_k else float(MD_TEMP_K)
            final_temp = float(temp_series_k[-1]) if temp_series_k else float(MD_TEMP_K)
            yield cancelled_payload(
                f"MD stopped by user at step {step}",
                step=step,
                steps=MD_STEPS,
                avg_temperature_k=avg_temp,
                final_temperature_k=final_temp,
                total_time_ps=step * MD_TIMESTEP_FS / 1000.0,
                cif_md_start=cif_md_start,
                na_removed_for_md=int(md_na_removed),
                na_vacancy_fraction=MD_NA_VACANCY_FRACTION,
            )
            return

        dyn.run(1)

        curr_scaled = atoms_md.get_scaled_positions(wrap=True)
        delta = curr_scaled - prev_scaled

        delta[:, 0] = delta[:, 0] - np.round(delta[:, 0]) if pbc[0] else delta[:, 0]
        delta[:, 1] = delta[:, 1] - np.round(delta[:, 1]) if pbc[1] else delta[:, 1]
        delta[:, 2] = delta[:, 2] - np.round(delta[:, 2]) if pbc[2] else delta[:, 2]

        cumulative_frac += delta
        prev_scaled = curr_scaled

        disp_cart = cumulative_frac @ cell
        sq = np.sum(disp_cart ** 2, axis=1)

        time_ps = step * MD_TIMESTEP_FS / 1000.0
        msd_na = float(np.mean(sq[na_mask])) if np.any(na_mask) else 0.0
        msd_non_na = float(np.mean(sq[non_na_mask])) if np.any(non_na_mask) else 0.0

        ek = atoms_md.get_kinetic_energy()
        t_inst = ek / (1.5 * units.kB * len(atoms_md))
        temp_series_k.append(float(t_inst))

        if step % MD_LOG_INTERVAL == 0 or step == 1 or step == MD_STEPS:
            log(f"[MD] step {step}/{MD_STEPS} | T = {t_inst:.1f} K")

        yield {
            "event": "progress",
            "step": step,
            "steps": MD_STEPS,
            "time_ps": float(time_ps),
            "msd_na": msd_na,
            "msd_non_na": msd_non_na,
            "temperature_k": float(t_inst),
            "progress": float(step / MD_STEPS),
        }

    avg_temp = float(np.mean(temp_series_k)) if temp_series_k else float(MD_TEMP_K)
    final_temp = float(temp_series_k[-1]) if temp_series_k else float(MD_TEMP_K)

    yield {
        "event": "result",
        "potential": potential,
        "temperature_k": MD_TEMP_K,
        "timestep_fs": MD_TIMESTEP_FS,
        "steps": MD_STEPS,
        "sample_interval": MD_SAMPLE_INTERVAL,
        "total_time_ps": MD_STEPS * MD_TIMESTEP_FS / 1000.0,
        "n_atoms": len(atoms_md),
        "n_na_atoms": int(np.sum(na_mask)),
        "n_non_na_atoms": int(np.sum(non_na_mask)),
        "avg_temperature_k": avg_temp,
        "final_temperature_k": final_temp,
        "na_vacancy_fraction": MD_NA_VACANCY_FRACTION,
        "na_removed_for_md": int(md_na_removed),
        "cif_md_start": cif_md_start,
    }
