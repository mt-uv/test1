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
