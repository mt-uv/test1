import json
from typing import Dict
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse

from model import (
    MD_DEFAULT_TEMPERATURE_K,
    MD_DEFAULT_TIMESTEP_FS,
    MD_DEFAULT_TOTAL_TIME_PS,
    RELAX_FMAX,
    RELAX_STEPS,
    atoms_to_cif_string,
    run_nvt_md_stream,
    run_relaxation_stream,
    uploaded_file_to_atoms,
)

app = FastAPI(title="Na-ion Runpod Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RELAX_SESSIONS: Dict[str, Dict] = {}
RELAX_RESULTS: Dict[str, Dict] = {}

MD_SESSIONS: Dict[str, Dict] = {}
MD_RESULTS: Dict[str, Dict] = {}
MD_CANCEL_FLAGS: Dict[str, bool] = {}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/preview-structure")
async def preview_structure(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        atoms = uploaded_file_to_atoms(file.filename or "structure.cif", content)
        cif_text = atoms_to_cif_string(atoms)
        return {
            "filename": file.filename or "structure.cif",
            "n_atoms": len(atoms),
            "cif": cif_text,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse structure: {e}")


@app.post("/relax-upload-session")
async def create_relax_upload_session(
    file: UploadFile = File(...),
    potential: str = Form("uma"),
    optimizer: str = Form("LBFGS"),
    fmax: float = Form(RELAX_FMAX),
    steps: int = Form(RELAX_STEPS),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    session_id = uuid4().hex
    RELAX_SESSIONS[session_id] = {
        "filename": file.filename or "structure.cif",
        "content": content,
        "potential": potential,
        "optimizer": optimizer,
        "fmax": fmax,
        "steps": steps,
    }
    return {"session_id": session_id}


@app.get("/relax-upload-stream/{session_id}")
def relax_upload_stream(session_id: str):
    payload = RELAX_SESSIONS.pop(session_id, None)
    if payload is None:
        raise HTTPException(status_code=404, detail="Relax session not found or already used")

    def event_stream():
        try:
            result_id = uuid4().hex

            for item in run_relaxation_stream(
                filename=payload["filename"],
                file_bytes=payload["content"],
                potential=payload["potential"],
                optimizer=payload["optimizer"],
                fmax=float(payload["fmax"]),
                steps=int(payload["steps"]),
            ):
                if item.get("event") == "result":
                    RELAX_RESULTS[result_id] = {
                        "relaxed_cif": item["relaxed_cif"],
                        "traj_path": item["traj_path"],
                    }
                    item["result_id"] = result_id

                event = item.get("event", "progress")
                yield f"event: {event}\n"
                yield "data: " + json.dumps(item) + "\n\n"

            yield "event: done\n"
            yield 'data: {"message":"Relaxation completed"}\n\n'

        except Exception as e:
            yield "event: error\n"
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/download-relaxed-cif/{result_id}")
def download_relaxed_cif(result_id: str):
    payload = RELAX_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Relaxation result not found")

    return PlainTextResponse(
        payload["relaxed_cif"],
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="relaxed_structure.cif"'},
    )


@app.get("/download-relax-traj/{result_id}")
def download_relax_traj(result_id: str):
    payload = RELAX_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Relaxation result not found")

    return FileResponse(
        payload["traj_path"],
        filename="relaxation.traj",
        media_type="application/octet-stream",
    )


@app.post("/md-upload-session")
async def create_md_upload_session(
    file: UploadFile = File(...),
    potential: str = Form("uma"),
    temperature_k: float = Form(MD_DEFAULT_TEMPERATURE_K),
    timestep_fs: float = Form(MD_DEFAULT_TIMESTEP_FS),
    total_time_ps: float = Form(MD_DEFAULT_TOTAL_TIME_PS),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    session_id = uuid4().hex
    MD_SESSIONS[session_id] = {
        "filename": file.filename or "structure.cif",
        "content": content,
        "potential": potential,
        "temperature_k": temperature_k,
        "timestep_fs": timestep_fs,
        "total_time_ps": total_time_ps,
    }
    MD_CANCEL_FLAGS[session_id] = False

    return {"session_id": session_id}


@app.get("/md-upload-stream/{session_id}")
def md_upload_stream(session_id: str):
    payload = MD_SESSIONS.pop(session_id, None)
    if payload is None:
        raise HTTPException(status_code=404, detail="MD session not found or already used")

    if session_id not in MD_CANCEL_FLAGS:
        MD_CANCEL_FLAGS[session_id] = False

    def cancel_check() -> bool:
        return MD_CANCEL_FLAGS.get(session_id, False)

    def event_stream():
        try:
            result_id = uuid4().hex

            for item in run_nvt_md_stream(
                filename=payload["filename"],
                file_bytes=payload["content"],
                potential=payload["potential"],
                temperature_k=float(payload["temperature_k"]),
                timestep_fs=float(payload["timestep_fs"]),
                total_time_ps=float(payload["total_time_ps"]),
                cancel_check=cancel_check,
            ):
                if item.get("event") == "result":
                    MD_RESULTS[result_id] = {
                        "final_cif": item["final_cif"],
                        "traj_path": item["traj_path"],
                    }
                    item["result_id"] = result_id

                event = item.get("event", "progress")
                yield f"event: {event}\n"
                yield "data: " + json.dumps(item) + "\n\n"

            yield "event: done\n"
            yield 'data: {"message":"MD completed"}\n\n'

        except Exception as e:
            yield "event: error\n"
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"
        finally:
            MD_CANCEL_FLAGS.pop(session_id, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/stop-upload-md/{session_id}")
def stop_upload_md(session_id: str):
    if session_id not in MD_CANCEL_FLAGS:
        raise HTTPException(status_code=404, detail="MD session not found")

    MD_CANCEL_FLAGS[session_id] = True
    return JSONResponse({"ok": True, "message": f"Stop requested for session {session_id}"})


@app.get("/download-upload-md-cif/{result_id}")
def download_upload_md_cif(result_id: str):
    payload = MD_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="MD result not found")

    return PlainTextResponse(
        payload["final_cif"],
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="md_final_structure.cif"'},
    )


@app.get("/download-upload-md-traj/{result_id}")
def download_upload_md_traj(result_id: str):
    payload = MD_RESULTS.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="MD result not found")

    return FileResponse(
        payload["traj_path"],
        filename="md_trajectory.traj",
        media_type="application/octet-stream",
    )
