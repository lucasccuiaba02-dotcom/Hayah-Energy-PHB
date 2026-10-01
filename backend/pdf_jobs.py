"""Set/2026 · Geração de PDFs pesados (Diário de Obra / Avanço Físico com centenas de fotos) em segundo plano.
O cliente dispara o job, consulta o progresso e baixa o arquivo quando pronto (evita timeout do proxy/Cloudflare)."""
import asyncio
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

JOBS: dict = {}
TTL_SECONDS = 1800
MAX_ACTIVE_PER_USER = 2
PUBLIC_KEYS = ("id", "kind", "status", "done", "total", "message", "filename", "error", "size", "created_at", "finished_at")


def _cleanup():
    now = time.time()
    for k in [k for k, j in JOBS.items() if now - j["created_at"] > TTL_SECONDS]:
        JOBS.pop(k, None)


def public(job: dict) -> dict:
    out = {k: job.get(k) for k in PUBLIC_KEYS}
    out["pct"] = round(100 * job["done"] / job["total"]) if job.get("total") else (100 if job["status"] == "done" else 0)
    out["download_url"] = f"/api/pdf-jobs/{job['id']}/download" if job["status"] == "done" else None
    return out


def start_job(user_id: str, kind: str, filename: str, runner) -> dict:
    """runner(progress) -> bytes (async). progress(done, total, message='')."""
    _cleanup()
    active = [j for j in JOBS.values() if j["user_id"] == user_id and j["status"] in ("queued", "running")]
    if len(active) >= MAX_ACTIVE_PER_USER:
        raise HTTPException(status_code=429, detail="Já existe uma geração de PDF em andamento. Aguarde terminar.")
    job = {"id": uuid.uuid4().hex[:16], "user_id": user_id, "kind": kind, "status": "queued", "done": 0, "total": 0, "message": "Na fila…",
           "filename": filename, "result": None, "error": "", "size": 0, "created_at": time.time(), "finished_at": None}
    JOBS[job["id"]] = job

    def progress(done, total, message=""):
        job["done"], job["total"] = int(done), int(total)
        if message:
            job["message"] = message

    async def _run():
        job["status"] = "running"
        try:
            job["result"] = await runner(progress)
            job["size"] = len(job["result"] or b"")
            job["status"], job["message"] = "done", "PDF pronto"
        except Exception as e:  # noqa: BLE001
            job["status"], job["error"], job["message"] = "error", str(e)[:300], "Falha ao gerar o PDF"
        job["finished_at"] = time.time()

    asyncio.create_task(_run())
    return public(job)


def build_router(get_current_user):
    router = APIRouter(prefix="/api/pdf-jobs")

    def _get(job_id: str, user):
        job = JOBS.get(job_id)
        if not job or job["user_id"] != user["_id"]:
            raise HTTPException(status_code=404, detail="Geração não encontrada (expirada?). Gere o PDF novamente.")
        return job

    @router.get("/{job_id}")
    async def job_status(job_id: str, current_user: dict = Depends(get_current_user)):
        return public(_get(job_id, current_user))

    @router.get("/{job_id}/download")
    async def job_download(job_id: str, current_user: dict = Depends(get_current_user)):
        job = _get(job_id, current_user)
        if job["status"] != "done" or not job["result"]:
            raise HTTPException(status_code=409, detail="PDF ainda não está pronto")
        return Response(content=job["result"], media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{job["filename"]}"', "Content-Length": str(len(job["result"]))})

    return router
