from __future__ import annotations

import io
import os
import tempfile
from functools import lru_cache

import numpy as np
from ase.io import read
from ase.io.trajectory import Trajectory
from ase.optimize import LBFGS, BFGS, FIRE
from fairchem.core import FAIRChemCalculator
from fairchem.core.units.mlip_unit import load_predict_unit
from huggingface_hub import hf_hub_download
from orb_models.forcefield import pretrained
from orb_models.forcefield.calculator import ORBCalculator
from pymatgen.io.ase import AseAtomsAdaptor
from pymatgen.io.cif import CifWriter

# ----------------------------
# Config
# ----------------------------

RELAX_FMAX = 0.05
RELAX_STEPS = 300
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


# ----------------------------
# ML calculators
# ----------------------------

@lru_cache(maxsize=1)
def get_uma_calc():
    log("[INIT] Loading UMA calculator...")

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

    traj.close()

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
    }