import json
from typing import Dict
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse

from model import (
    RELAX_FMAX,
    RELAX_STEPS,
    atoms_to_cif_string,
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