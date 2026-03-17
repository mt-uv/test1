import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
import httpx

RUNPOD_BASE_URL = os.getenv("RUNPOD_BASE_URL", "http://localhost:9000")

app = FastAPI(title="Na-ion Railway API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/preview-structure")
async def preview_structure(file: UploadFile = File(...)):
    content = await file.read()
    files = {"file": (file.filename or "structure.cif", content, file.content_type or "application/octet-stream")}

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{RUNPOD_BASE_URL}/preview-structure", files=files)

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )

@app.post("/relax-upload-session")
async def relax_upload_session(
    file: UploadFile = File(...),
    potential: str = Form("uma"),
    optimizer: str = Form("LBFGS"),
    fmax: float = Form(0.05),
    steps: int = Form(300),
):
    content = await file.read()
    files = {
        "file": (file.filename or "structure.cif", content, file.content_type or "application/octet-stream")
    }
    data = {
        "potential": potential,
        "optimizer": optimizer,
        "fmax": str(fmax),
        "steps": str(steps),
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{RUNPOD_BASE_URL}/relax-upload-session", files=files, data=data)

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )

@app.get("/relax-upload-stream/{session_id}")
async def relax_upload_stream(session_id: str):
    async def streamer():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", f"{RUNPOD_BASE_URL}/relax-upload-stream/{session_id}") as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(
        streamer(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/download-relaxed-cif/{result_id}")
async def download_relaxed_cif(result_id: str):
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(f"{RUNPOD_BASE_URL}/download-relaxed-cif/{result_id}")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "text/plain"),
        headers={
            "Content-Disposition": resp.headers.get(
                "content-disposition",
                'attachment; filename="relaxed_structure.cif"',
            )
        },
    )

@app.get("/download-relax-traj/{result_id}")
async def download_relax_traj(result_id: str):
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(f"{RUNPOD_BASE_URL}/download-relax-traj/{result_id}")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/octet-stream"),
        headers={
            "Content-Disposition": resp.headers.get(
                "content-disposition",
                'attachment; filename="relaxation.traj"',
            )
        },
    )