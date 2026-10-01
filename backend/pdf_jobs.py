"""Set/2026 · Geração de PDFs pesados (Diário de Obra / Avanço Físico com centenas de fotos) em segundo plano.
O cliente dispara o job, consulta o progresso e baixa o arquivo quando pronto (evita timeout do proxy/Cloudflare).
Out/2026 · estado persistido em `pdf_jobs` (Mongo) + PDF no Object Storage → sobrevive a restart/múltiplas réplicas;
heartbeat detecta geração interrompida em vez de "sumir" o job."""
import asyncio
import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)
JOBS: dict = {}  # cache do processo que está gerando (resultado em memória por alguns minutos)
TTL_SECONDS = 1800
RESULT_MEMORY_SECONDS = 300
STALE_SECONDS = 150
MAX_ACTIVE_PER_USER = 2
STORAGE_PREFIX = "hayah-energy/pdf-jobs"
PUBLIC_KEYS = ("id", "kind", "status", "done", "total", "message", "filename", "error", "size", "created_at", "finished_at")
PERSIST_KEYS = ("status", "done", "total", "message", "error", "size", "storage_path", "finished_at", "heartbeat")

_db = None
_storage_put = None
_storage_get = None


def configure(db, storage_put, storage_get):
    global _db, _storage_put, _storage_get
    _db, _storage_put, _storage_get = db, storage_put, storage_get


async def ensure_indexes():
    try:
        await _db.pdf_jobs.create_index("id", unique=True)
        await _db.pdf_jobs.create_index("created_dt", expireAfterSeconds=86400)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"pdf_jobs indexes: {e}")


def _cleanup():
    now = time.time()
    for k, j in list(JOBS.items()):
        if now - j["created_at"] > TTL_SECONDS:
            JOBS.pop(k, None)
        elif j.get("result") and j.get("storage_path") and j.get("finished_at") and now - j["finished_at"] > RESULT_MEMORY_SECONDS:
            j["result"] = None


def _effective(job: dict) -> dict:
    """Job sem heartbeat recente ainda 'rodando' = processo caiu/reiniciou no meio da geração."""
    if job.get("status") in ("queued", "running") and time.time() - float(job.get("heartbeat") or job.get("created_at") or 0) > STALE_SECONDS:
        return {**job, "status": "error", "message": "Falha ao gerar o PDF",
                "error": "Geração interrompida (o servidor reiniciou durante o processamento). Gere o PDF novamente."}
    return job


def public(job: dict) -> dict:
    job = _effective(job)
    out = {k: job.get(k) for k in PUBLIC_KEYS}
    out["pct"] = round(100 * job["done"] / job["total"]) if job.get("total") else (100 if job["status"] == "done" else 0)
    out["download_url"] = f"/api/pdf-jobs/{job['id']}/download" if job["status"] == "done" else None
    return out


async def _persist(job_id: str, fields: dict):
    try:
        await _db.pdf_jobs.update_one({"id": job_id}, {"$set": fields})
    except Exception as e:  # noqa: BLE001
        logger.warning(f"pdf job {job_id} persist: {e}")


async def start_job(user_id: str, kind: str, filename: str, runner) -> dict:
    """runner(progress) -> bytes (async). progress(done, total, message='')."""
    _cleanup()
    now = time.time()
    active = await _db.pdf_jobs.count_documents({"user_id": user_id, "status": {"$in": ["queued", "running"]}, "heartbeat": {"$gte": now - STALE_SECONDS}})
    if active >= MAX_ACTIVE_PER_USER:
        raise HTTPException(status_code=429, detail="Já existe uma geração de PDF em andamento. Aguarde terminar (acompanhe a barra de progresso).")
    job = {"id": uuid.uuid4().hex[:16], "user_id": user_id, "kind": kind, "status": "queued", "done": 0, "total": 0, "message": "Na fila…",
           "filename": filename, "result": None, "error": "", "size": 0, "storage_path": "", "created_at": now, "finished_at": None, "heartbeat": now}
    JOBS[job["id"]] = job
    from datetime import datetime, timezone
    await _db.pdf_jobs.insert_one({**{k: v for k, v in job.items() if k != "result"}, "created_dt": datetime.now(timezone.utc)})

    last = {"t": 0.0}

    def progress(done, total, message=""):
        job["done"], job["total"] = int(done), int(total)
        if message:
            job["message"] = message
        job["heartbeat"] = time.time()
        if job["heartbeat"] - last["t"] >= 1.0:
            last["t"] = job["heartbeat"]
            asyncio.get_running_loop().create_task(_persist(job["id"], {"done": job["done"], "total": job["total"], "message": job["message"], "heartbeat": job["heartbeat"]}))

    async def _run():
        job["status"] = "running"
        await _persist(job["id"], {"status": "running", "heartbeat": time.time()})
        try:
            pdf = await runner(progress)
            job["result"], job["size"] = pdf, len(pdf or b"")
            job["heartbeat"] = time.time()
            path = f"{STORAGE_PREFIX}/{job['id']}.pdf"
            try:
                await _storage_put(path, pdf, "application/pdf")
                job["storage_path"] = path
            except Exception as e:  # noqa: BLE001
                logger.warning(f"pdf job {job['id']}: falha ao guardar no storage, mantendo só em memória: {e}")
            job["status"], job["message"] = "done", "PDF pronto"
        except Exception as e:  # noqa: BLE001
            logger.exception(f"pdf job {job['id']} falhou")
            job["status"], job["error"], job["message"] = "error", str(e)[:300] or e.__class__.__name__, "Falha ao gerar o PDF"
        job["finished_at"] = job["heartbeat"] = time.time()
        await _persist(job["id"], {k: job.get(k) for k in PERSIST_KEYS} | {"done": job["done"], "total": job["total"]})

    asyncio.create_task(_run())
    return public(job)


def build_router(get_current_user):
    router = APIRouter(prefix="/api/pdf-jobs")

    async def _get(job_id: str, user):
        job = JOBS.get(job_id) or await _db.pdf_jobs.find_one({"id": job_id}, {"_id": 0})
        if not job or job.get("user_id") != user["_id"]:
            raise HTTPException(status_code=404, detail="Geração não encontrada (expirada?). Gere o PDF novamente.")
        return job

    @router.get("/{job_id}")
    async def job_status(job_id: str, current_user: dict = Depends(get_current_user)):
        return public(await _get(job_id, current_user))

    @router.get("/{job_id}/download")
    async def job_download(job_id: str, current_user: dict = Depends(get_current_user)):
        job = await _get(job_id, current_user)
        pub = public(job)
        if pub["status"] == "error":
            raise HTTPException(status_code=409, detail=pub["error"] or "Falha ao gerar o PDF")
        if pub["status"] != "done":
            raise HTTPException(status_code=409, detail="PDF ainda não está pronto")
        data = job.get("result")
        if not data and job.get("storage_path"):
            data, _ct = await _storage_get(job["storage_path"])
        if not data:
            raise HTTPException(status_code=410, detail="Este PDF expirou. Gere novamente.")
        return Response(content=data, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{job["filename"]}"', "Content-Length": str(len(data)), "Cache-Control": "private, max-age=0"})

    return router
