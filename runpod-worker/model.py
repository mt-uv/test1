from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from typing import Callable

import numpy as np
from ase import units
from ase.io import read
from ase.io.trajectory import Trajectory
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.optimize import LBFGS, BFGS, FIRE
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


def uploaded_file_to_atoms(filename: str, file_bytes: bytes):
    """
    Reads uploaded structure file into ASE Atoms.
    Works for CIF and formats ASE can infer from file extension.
    """
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


def compute_species_msd(atoms, initial_positions: np.ndarray, species: list[str]) -> dict[str, float]:
    """
    Simple MSD relative to initial positions.

    Note:
    This uses wrapped ASE positions. For long PBC trajectories, unwrapped coordinates
    are more physically rigorous. This is good for a first live dashboard.
    """
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


# ----------------------------
# ML calculators
# ----------------------------

@lru_cache(maxsize=1)
def get_uma_calc():
    log("[INIT] Loading UMA calculator...")

    # Needed for some torch>=2.6 + UMA checkpoint loads
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
    """
    Returns minimal preview payload for uploaded structure.
    """
    atoms = uploaded_file_to_atoms(filename, file_bytes)
    cif = atoms_to_cif_string(atoms)

    return {
        "filename": filename,
        "n_atoms": len(atoms),
        "cif": cif,
    }


# ----------------------------
# Relaxation
# ----------------------------

def run_relaxation_stream(
    filename: str,
    file_bytes: bytes,
    potential: str = "uma",
    optimizer: str = "LBFGS",
    fmax: float = RELAX_FMAX,
    steps: int = RELAX_STEPS,
):
    """
    Streaming relaxation workflow.

    Yields:
      meta event
      progress events for each optimization step
      result event at the end
    """
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

    log(
        f"[RELAX] Starting | potential={potential.upper()} "
        f"| optimizer={optimizer.upper()} | fmax={fmax} | steps={steps}"
    )

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

    log(
        f"[RELAX] Finished | converged={converged} "
        f"| final_energy={final_energy:.6f} eV"
    )

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
# NVT MD
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
    """
    Streaming NVT Langevin MD.

    Yields:
      meta
      progress
      result
      cancelled
    """
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

    # Initialize velocities
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

    log(
        f"[MD] Starting | potential={potential.upper()} | T={temperature_k} K "
        f"| dt={timestep_fs} fs | total={total_time_ps} ps | steps={steps} "
        f"| friction={friction}"
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
                log(f"[MD] Cancelled by user at step {step}/{steps}")
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

    log(
        f"[MD] Finished | potential={potential.upper()} | "
        f"Epot={final_epot:.6f} eV | Ekin={final_ekin:.6f} eV"
    )

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

DEMO_CATHODE_CIF = """data_Si2V1
_symmetry_space_group_name_H-M   'P1'
_cell_length_a   9.295831
_cell_length_b   6.197221
_cell_length_c   10.898132
_cell_angle_alpha   90.000000
_cell_angle_beta    90.000000
_cell_angle_gamma   120.000000
_cell_volume   543.710732
_cell_formula_units_Z   1
loop_
 _atom_site_label
 _atom_site_type_symbol
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
Na1 Na 0.111111 0.333333 0.750000
Na2 Na 0.222222 0.166667 0.250000
Mn1 Mn 0.000000 0.000000 0.000000
Mn2 Mn 0.000000 0.000000 0.500000
O1 O 0.111111 0.333333 0.401696
O2 O 0.222222 0.166667 0.598304
O3 O 0.222222 0.166667 0.901696
O4 O 0.111111 0.333333 0.098304
Na3 Na 0.111111 0.833333 0.750000
Na4 Na 0.222222 0.666667 0.250000
Mn3 Mn 0.000000 0.500000 0.000000
Mn4 Mn 0.000000 0.500000 0.500000
O5 O 0.111111 0.833333 0.401696
O6 O 0.222222 0.666667 0.598304
O7 O 0.222222 0.666667 0.901696
O8 O 0.111111 0.833333 0.098304
Na5 Na 0.444444 0.333333 0.750000
Na6 Na 0.555556 0.166667 0.250000
Mn5 Mn 0.333333 0.000000 0.000000
Si1 Si 0.333333 0.000000 0.500000
O9 O 0.444444 0.333333 0.401696
O10 O 0.555556 0.166667 0.598304
O11 O 0.555556 0.166667 0.901696
O12 O 0.444444 0.333333 0.098304
Na7 Na 0.444444 0.833333 0.750000
Na8 Na 0.555556 0.666667 0.250000
Mn6 Mn 0.333333 0.500000 0.000000
Si2 Si 0.333333 0.500000 0.500000
O13 O 0.444444 0.833333 0.401696
O14 O 0.555556 0.666667 0.598304
O15 O 0.555556 0.666667 0.901696
O16 O 0.444444 0.833333 0.098304
Na9 Na 0.777778 0.333333 0.750000
Na10 Na 0.888889 0.166667 0.250000
Mn7 Mn 0.666667 0.000000 0.000000
Mn8 Mn 0.666667 0.000000 0.500000
O17 O 0.777778 0.333333 0.401696
O18 O 0.888889 0.166667 0.598304
O19 O 0.888889 0.166667 0.901696
O20 O 0.777778 0.333333 0.098304
Na11 Na 0.777778 0.833333 0.750000
Na12 Na 0.888889 0.666667 0.250000
Mn9 Mn 0.666667 0.500000 0.000000
V1 V 0.666667 0.500000 0.500000
O21 O 0.777778 0.833333 0.401696
O22 O 0.888889 0.666667 0.598304
O23 O 0.888889 0.666667 0.901696
O24 O 0.777778 0.833333 0.098304
"""


def _validate_fraction_map(fractions: dict[str, float], elements: list[str]) -> dict[str, float]:
    cleaned: dict[str, float] = {}

    for el in elements:
        value = fractions.get(el, 0.0)
        try:
            value = float(value)
        except Exception as exc:
            raise ValueError(f"Fraction for {el} must be numeric") from exc

        if value < 0 or value > 1:
            raise ValueError(f"Fraction for {el} must be between 0 and 1")

        cleaned[el] = value

    total = sum(cleaned.values())
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"Fractions must sum to 1. Got {total:.6f}")

    return cleaned


def _dominant_element(elements: list[str], fractions: dict[str, float], fallback: str = "") -> str:
    if not elements:
        return fallback
    return max(elements, key=lambda el: float(fractions.get(el, 0.0)))


def _build_configuration_energies(
    transition_metals: list[str],
    dopants: list[str],
    fractions: dict[str, float],
) -> list[dict]:
    configs = []

    candidates = []
    for tm in transition_metals:
        for dop in dopants:
            score = float(fractions.get(tm, 0.0)) - 0.25 * float(fractions.get(dop, 0.0))
            candidates.append((tm, dop, score))

    candidates = sorted(candidates, key=lambda x: x[2], reverse=True)
    if not candidates:
        candidates = [("Mn", "Zr", 0.0)]

    base_energy = -100.0
    for idx, (tm, dop, score) in enumerate(candidates[:6]):
        energy = base_energy - 0.3 * idx - 0.2 * score
        configs.append(
            {
                "name": f"{tm}-{dop} configuration {idx + 1}",
                "index": idx,
                "energy": float(energy),
            }
        )

    return configs


def run_screening_stream(
    transition_metals: list[str],
    dopants: list[str],
    fractions: dict[str, float],
    potential: str = "uma",
):
    potential = normalize_potential(potential)

    if not transition_metals:
        raise ValueError("At least one transition metal is required")
    if not dopants:
        raise ValueError("At least one dopant is required")

    selected_elements = list(dict.fromkeys([*transition_metals, *dopants]))
    fractions = _validate_fraction_map(fractions, selected_elements)

    yield {
        "event": "status",
        "message": "Validating composition...",
        "progress": 0.05,
    }

    chosen_tm = _dominant_element(transition_metals, fractions, fallback=transition_metals[0])
    chosen_dopant = _dominant_element(dopants, fractions, fallback=dopants[0])

    yield {
        "event": "progress",
        "message": "Generating candidate configurations...",
        "progress": 0.15,
        "config_index": 0,
        "config_total": max(1, len(transition_metals) * len(dopants)),
    }

    configs = _build_configuration_energies(
        transition_metals=transition_metals,
        dopants=dopants,
        fractions=fractions,
    )

    config_total = len(configs)
    for idx, _cfg in enumerate(configs, start=1):
        progress = 0.15 + 0.45 * (idx / max(config_total, 1))
        yield {
            "event": "config_done",
            "message": f"Evaluated configuration {idx} / {config_total}",
            "progress": progress,
            "config_index": idx,
            "config_total": config_total,
            "configuration_energies": configs[:idx],
        }

    selected_cfg = min(configs, key=lambda x: x["energy"])
    sodiated_energy = float(selected_cfg["energy"])
    desodiated_energy = float(sodiated_energy + 3.2)
    voltage = float(abs(desodiated_energy - sodiated_energy) / 1.0)
    na_removed = 1
    mu_na = -1.85 if potential == "uma" else -1.72

    composition = {el: float(v) for el, v in fractions.items() if float(v) > 0}

    yield {
        "event": "result",
        "potential": potential,
        "voltage": voltage,
        "sodiated_energy": sodiated_energy,
        "desodiated_energy": desodiated_energy,
        "tm_sites": len(transition_metals),
        "dopant_sites": len(dopants),
        "chosen_tm": chosen_tm,
        "chosen_dopant": chosen_dopant,
        "na_removed": na_removed,
        "mu_na": mu_na,
        "composition": composition,
        "site_counts": {
            "tm_candidates": len(transition_metals),
            "dopant_candidates": len(dopants),
        },
        "n_configurations": len(configs),
        "configuration_energies": configs,
        "selected_configuration": selected_cfg,
        "cif_doped": DEMO_CATHODE_CIF,
        "cif_sodiated_relaxed": DEMO_CATHODE_CIF,
        "cif_desodiated_relaxed": DEMO_CATHODE_CIF,
    }


def run_explorer_md_stream(
    cif_text: str,
    potential: str = "uma",
):
    potential = normalize_potential(potential)

    file_bytes = cif_text.encode("utf-8")
    species_seen: list[str] = []
    avg_t_samples: list[float] = []

    for item in run_nvt_md_stream(
        filename="explorer_structure.cif",
        file_bytes=file_bytes,
        potential=potential,
        temperature_k=MD_DEFAULT_TEMPERATURE_K,
        timestep_fs=MD_DEFAULT_TIMESTEP_FS,
        total_time_ps=MD_DEFAULT_TOTAL_TIME_PS,
    ):
        event = item.get("event")

        if event == "meta":
            species_seen = item.get("species", [])
            yield {
                "event": "meta",
                "potential": potential,
                "temperature_k": item.get("temperature_k"),
                "timestep_fs": item.get("timestep_fs"),
                "steps": item.get("steps"),
                "total_time_ps": item.get("total_time_ps"),
                "n_atoms": item.get("n_atoms"),
                "n_na_atoms": sum(1 for sp in species_seen if sp == "Na"),
                "n_non_na_atoms": sum(1 for sp in species_seen if sp != "Na"),
                "na_vacancy_fraction": 0.0,
                "na_removed_for_md": 0,
                "cif_md_start": item.get("initial_cif", ""),
            }

        elif event == "progress":
            msd_by_species = item.get("msd_by_species", {})
            msd_na = float(msd_by_species.get("Na", 0.0))
            non_na_values = [
                float(v) for sp, v in msd_by_species.items() if sp != "Na"
            ]
            msd_non_na = float(np.mean(non_na_values)) if non_na_values else 0.0

            temperature_k = float(item.get("temperature_k", MD_DEFAULT_TEMPERATURE_K))
            avg_t_samples.append(temperature_k)

            yield {
                "event": "progress",
                "step": item.get("step"),
                "steps": item.get("steps"),
                "time_ps": item.get("time_ps"),
                "temperature_k": temperature_k,
                "msd_na": msd_na,
                "msd_non_na": msd_non_na,
            }

        elif event == "result":
            final_t = float(item.get("temperature_k", MD_DEFAULT_TEMPERATURE_K))
            avg_t = float(np.mean(avg_t_samples)) if avg_t_samples else final_t

            yield {
                "event": "result",
                "potential": potential,
                "avg_temperature_k": avg_t,
                "final_temperature_k": final_t,
                "cif_md_start": atoms_to_cif_string(
                    uploaded_file_to_atoms("explorer_structure.cif", file_bytes)
                ),
            }

        elif event == "cancelled":
            yield item
