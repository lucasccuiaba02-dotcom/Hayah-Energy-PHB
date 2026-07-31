from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from bson import ObjectId
from typing import List, Optional, Tuple
from datetime import datetime, timezone, timedelta
import os
import logging
import bcrypt
import jwt
import secrets
import asyncio
import base64
import uuid
import io
import httpx

from push_notifications import ensure_vapid_keys, broadcast_push
from daily_log_pdf import build_daily_log_pdf
from route_pdf import build_route_pdf
from material_requisition_pdf import build_requisition_pdf

# Module-level cache for geocoding (TTL 60s handled per request)
_geocode_cache: dict = {}

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"

# --- Emergent Object Storage ---
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "hayah-energy"
_storage_key: Optional[str] = None

async def init_storage() -> Optional[str]:
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not emergent_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client_http:
            resp = await client_http.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key})
            resp.raise_for_status()
            _storage_key = resp.json()["storage_key"]
            return _storage_key
    except Exception as e:
        logging.getLogger(__name__).error(f"Storage init failed: {e}")
        return None

async def storage_put(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = await init_storage()
    if not key:
        raise HTTPException(status_code=503, detail="Armazenamento indisponível — verifique EMERGENT_LLM_KEY")
    async with httpx.AsyncClient(timeout=120) as client_http:
        resp = await client_http.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            content=data,
        )
        if resp.status_code == 403:
            _storage_key = None
            raise HTTPException(status_code=503, detail="Sessão de armazenamento expirada — tente de novo")
        resp.raise_for_status()
        return resp.json()

async def storage_get(path: str) -> Tuple[bytes, str]:
    key = await init_storage()
    if not key:
        raise HTTPException(status_code=503, detail="Armazenamento indisponível")
    async with httpx.AsyncClient(timeout=60) as client_http:
        resp = await client_http.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Arquivo não encontrado")
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# Project type labels (Hayah Energy specific) - Iteração 8
PROJECT_TYPE_LABELS = {
    "anexo_iv": "ANEXO IV",
    "po": "P.O",
    "nivel_tensao": "Nível de Tensão",
    "seguranca": "Segurança",
    "particular": "Particular",
    "auditoria": "AUDITORIA",
    "judicial": "JUDICIAL",
    "diretoria": "DIRETORIA",
}

# Tipos de serviço (usado ao programar)
TIPO_SERVICO_LABELS = {
    "extensao_rede_bt": "Extensão de Rede BT",
    "extensao_rede_mt": "Extensão de Rede MT",
    "extensao_rede_monofasica_rural": "Extensão Rede Monofásica Rural",
    "regulador": "Regulador",
    "religador": "Religador",
    "troca_trafo_mono": "Troca Trafo Mono",
    "troca_trafo_tri": "Troca Trafo Tri",
}

# Municípios da região Hayah
MUNICIPIOS = [
    "CUIABÁ",
    "VÁRZEA GRANDE",
    "SANTO ANTÔNIO DO LEVERGER",
    "ROSÁRIO OESTE",
    "ACORIZAL",
    "BARÃO DO MELGAÇO",
    "POCONÉ",
    "NOSSA SENHORA DO LIVRAMENTO",
    "CHAPADA DOS GUIMARÃES",
]

EXECUTION_STATUS_LABELS = {
    "aguardando_programacao": "Aguardando Programação",
    "programado": "Programado",
    "em_execucao": "Em Execução",
    "executada": "Executada",
    "concluido": "Concluído",
    "suspenso": "Suspenso",
    "cancelado": "Cancelado",
}

RESCHEDULE_REASONS = ["frota", "seguranca", "temporal", "chuva", "acesso", "outro"]

def safe_object_id(id_str: str) -> ObjectId:
    """Convert string to ObjectId, raise 404 if invalid."""
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")

# Utility Functions
def get_jwt_secret() -> str:
    return os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    status: str = "approved"
    permissions: List[str] = Field(default_factory=list)
    created_at: str
    access_token: Optional[str] = None

# Available page permissions
ALL_PERMISSIONS = [
    "dashboard", "carteira", "programacao", "calendario",
    "operacional", "geolocalizacao", "materiais", "analise",
    "relatorios", "equipes", "admin",
]

class TeamCreate(BaseModel):
    name: str
    members: List[str] = Field(default_factory=list)
    supervisor: str = ""
    member_count: int = 0

class TeamResponse(BaseModel):
    id: str
    name: str
    members: List[str]
    supervisor: str = ""
    member_count: int = 0
    created_at: str

class ProjectCreate(BaseModel):
    name: str
    project_code: str = ""
    tipo_servico: str = ""
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    additional_team_id: Optional[str] = None
    additional_team_name: Optional[str] = None
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    programmed_value: float = 0.0
    daily_goal: float = 0.0
    status: str = "active"
    priority: str = "medium"
    actual_value: float = 0.0
    billing_value: float = 0.0
    project_type: str = "anexo_iv"
    requires_hot_line: bool = False
    shutdown_info: str = ""
    location: str = ""
    labor_cost: float = 0.0
    material_cost: float = 0.0
    material_status: str = "pending"
    execution_status: str = "aguardando_programacao"
    is_scheduled: bool = False
    utm_x: str = ""
    utm_y: str = ""
    received_date: str = ""
    expiry_date: str = ""
    # Múltiplas programações (data + equipes)
    schedule_entries: Optional[List[dict]] = None
    # Motivo quando status = cancelado ou suspenso
    cancel_reason: str = ""
    # Quantitativos operacionais (planejado no cadastro)
    postes_qty: int = 0
    transformadores_qty: int = 0
    km_rede: float = 0.0
    ligacoes_novas: int = 0
    religacoes: int = 0
    desligamentos: int = 0

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    project_code: Optional[str] = None
    tipo_servico: Optional[str] = None
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    additional_team_id: Optional[str] = None
    additional_team_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    programmed_value: Optional[float] = None
    daily_goal: Optional[float] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    actual_value: Optional[float] = None
    billing_value: Optional[float] = None
    project_type: Optional[str] = None
    requires_hot_line: Optional[bool] = None
    shutdown_info: Optional[str] = None
    location: Optional[str] = None
    labor_cost: Optional[float] = None
    material_cost: Optional[float] = None
    material_status: Optional[str] = None
    execution_status: Optional[str] = None
    is_scheduled: Optional[bool] = None
    utm_x: Optional[str] = None
    utm_y: Optional[str] = None
    received_date: Optional[str] = None
    expiry_date: Optional[str] = None
    reschedule_reason: Optional[str] = None
    schedule_entries: Optional[List[dict]] = None
    cancel_reason: Optional[str] = None
    postes_qty: Optional[int] = None
    transformadores_qty: Optional[int] = None
    km_rede: Optional[float] = None
    ligacoes_novas: Optional[int] = None
    religacoes: Optional[int] = None
    desligamentos: Optional[int] = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    project_code: str = ""
    tipo_servico: str = ""
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    additional_team_id: Optional[str] = None
    additional_team_name: Optional[str] = None
    start_date: str
    end_date: str
    programmed_value: float
    daily_goal: float
    status: str
    priority: str
    actual_value: float
    billing_value: float = 0.0
    project_type: str = "anexo_iv"
    requires_hot_line: bool = False
    shutdown_info: str = ""
    location: str = ""
    labor_cost: float = 0.0
    material_cost: float = 0.0
    material_status: str = "pending"
    execution_status: str = "aguardando_programacao"
    is_scheduled: bool = False
    utm_x: str = ""
    utm_y: str = ""
    received_date: str = ""
    expiry_date: str = ""
    reschedule_history: List[dict] = Field(default_factory=list)
    schedule_entries: List[dict] = Field(default_factory=list)
    cancel_reason: str = ""
    attachments: List[dict] = Field(default_factory=list)
    materials_list: List[dict] = Field(default_factory=list)
    material_requisitions: List[dict] = Field(default_factory=list)
    billing_stage: str = ""
    billing_history: List[dict] = Field(default_factory=list)
    invoice_number: str = ""
    invoice_date: str = ""
    invoice_value: float = 0.0
    postes_qty: int = 0
    transformadores_qty: int = 0
    km_rede: float = 0.0
    ligacoes_novas: int = 0
    religacoes: int = 0
    desligamentos: int = 0
    created_at: str

class DashboardStats(BaseModel):
    total_projects: int
    active_projects: int
    total_programmed: float
    total_actual: float
    total_billing: float
    total_teams: int
    projects_on_track: int
    projects_lagging: int

# Auth Routes
@api_router.post("/auth/register", response_model=UserResponse)
async def register(user_data: UserRegister, response: Response):
    email = user_data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    password_hash = hash_password(user_data.password)
    user_doc = {
        "email": email,
        "password_hash": password_hash,
        "name": user_data.name,
        "role": "user",
        "status": "pending",
        "permissions": [],
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)

    return UserResponse(
        id=user_id,
        email=email,
        name=user_data.name,
        role="user",
        status="pending",
        permissions=[],
        created_at=user_doc["created_at"].isoformat(),
        access_token=None,
    )

@api_router.post("/auth/login", response_model=UserResponse)
async def login(credentials: UserLogin, response: Response, request: Request):
    email = credentials.email.lower()
    user = await db.users.find_one({"email": email})
    
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.get("status", "approved") == "pending":
        raise HTTPException(status_code=403, detail="Cadastro pendente de aprovação pelo administrador")
    if user.get("status") == "rejected":
        raise HTTPException(status_code=403, detail="Cadastro não autorizado")

    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")

    return UserResponse(
        id=user_id,
        email=user["email"],
        name=user["name"],
        role=user["role"],
        status=user.get("status", "approved"),
        permissions=user.get("permissions") if user.get("permissions") else ALL_PERMISSIONS,
        created_at=user["created_at"].isoformat(),
        access_token=access_token,
    )

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")
    return {"message": "Logged out successfully"}

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["_id"],
        email=current_user["email"],
        name=current_user["name"],
        role=current_user["role"],
        status=current_user.get("status", "approved"),
        permissions=current_user.get("permissions") if current_user.get("permissions") else ALL_PERMISSIONS,
        created_at=current_user["created_at"].isoformat()
    )

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    return current_user

@api_router.get("/admin/users")
async def admin_list_users(current_user: dict = Depends(require_admin)):
    users = await db.users.find({}).to_list(1000)
    return [{
        "id": str(u["_id"]),
        "email": u["email"],
        "name": u["name"],
        "role": u.get("role", "user"),
        "status": u.get("status", "approved"),
        "permissions": u.get("permissions", []),
        "created_at": u["created_at"].isoformat() if hasattr(u["created_at"], "isoformat") else u["created_at"],
    } for u in users]

class UserApprovalBody(BaseModel):
    permissions: List[str] = Field(default_factory=list)
    role: Optional[str] = "user"

@api_router.post("/admin/users/{user_id}/approve")
async def admin_approve_user(user_id: str, body: UserApprovalBody, current_user: dict = Depends(require_admin)):
    perms = [p for p in body.permissions if p in ALL_PERMISSIONS]
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {
        "status": "approved",
        "permissions": perms,
        "role": body.role or "user",
    }})
    return {"status": "approved", "permissions": perms}

@api_router.post("/admin/users/{user_id}/reject")
async def admin_reject_user(user_id: str, current_user: dict = Depends(require_admin)):
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "rejected"}})
    return {"status": "rejected"}

@api_router.put("/admin/users/{user_id}/permissions")
async def admin_update_permissions(user_id: str, body: UserApprovalBody, current_user: dict = Depends(require_admin)):
    perms = [p for p in body.permissions if p in ALL_PERMISSIONS]
    update = {"permissions": perms}
    if body.role: update["role"] = body.role
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update})
    return {"status": "updated", "permissions": perms}

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, current_user: dict = Depends(require_admin)):
    if str(current_user["_id"]) == user_id:
        raise HTTPException(status_code=400, detail="Não é possível remover o próprio usuário")
    await db.users.delete_one({"_id": ObjectId(user_id)})
    return {"status": "deleted"}

# ============ Team Unavailability ============
class TeamUnavailabilityBody(BaseModel):
    team_id: str
    date: str  # YYYY-MM-DD
    reason: str = "outro"
    notes: str = ""

@api_router.get("/team-unavailability")
async def list_team_unavailability(current_user: dict = Depends(get_current_user), start: str = "", end: str = ""):
    q = {"user_id": current_user["_id"]}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        q["date"] = rng
    docs = await db.team_unavailability.find(q).sort("date", 1).to_list(1000)
    return [{
        "id": str(d["_id"]),
        "team_id": d["team_id"],
        "team_name": d.get("team_name", ""),
        "date": d["date"],
        "reason": d.get("reason", "outro"),
        "notes": d.get("notes", ""),
    } for d in docs]

@api_router.post("/team-unavailability")
async def create_team_unavailability(body: TeamUnavailabilityBody, current_user: dict = Depends(get_current_user)):
    team = await db.teams.find_one({"_id": safe_object_id(body.team_id), "user_id": current_user["_id"]})
    if not team: raise HTTPException(status_code=404, detail="Equipe não encontrada")
    doc = {
        "user_id": current_user["_id"],
        "team_id": body.team_id,
        "team_name": team.get("name", ""),
        "date": body.date,
        "reason": body.reason,
        "notes": body.notes,
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.team_unavailability.update_one(
        {"user_id": current_user["_id"], "team_id": body.team_id, "date": body.date},
        {"$set": doc}, upsert=True,
    )
    return {"status": "ok", "team_id": body.team_id, "date": body.date, "reason": body.reason}

@api_router.delete("/team-unavailability/{unavailability_id}")
async def delete_team_unavailability(unavailability_id: str, current_user: dict = Depends(get_current_user)):
    await db.team_unavailability.delete_one({"_id": safe_object_id(unavailability_id), "user_id": current_user["_id"]})
    return {"status": "deleted"}

# ============ Retorno diário de programação ============
class DailyReturnBody(BaseModel):
    project_id: str
    date: str  # YYYY-MM-DD (data programada)
    executed: bool
    reason: Optional[str] = None  # motivo se não executado
    notes: Optional[str] = ""

@api_router.post("/programacao/return")
async def register_daily_return(body: DailyReturnBody, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(body.project_id), "user_id": current_user["_id"]})
    if not project: raise HTTPException(status_code=404, detail="Projeto não encontrado")
    entry = {
        "date": body.date,
        "executed": body.executed,
        "reason": body.reason or "",
        "notes": body.notes or "",
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "registered_by": current_user.get("email", ""),
    }
    update = {"$push": {"daily_returns": entry}}
    if body.executed:
        update["$set"] = {"execution_status": "executada", "execution_finished_at": entry["registered_at"]}
    else:
        update["$set"] = {"execution_status": "a_reprogramar"}
    await db.projects.update_one({"_id": safe_object_id(body.project_id)}, update)
    return {"status": "ok", "executed": body.executed, "new_status": update["$set"].get("execution_status")}

@api_router.get("/programacao/pending-returns")
async def pending_returns(current_user: dict = Depends(get_current_user), date: str = ""):
    """Retorna projetos programados para uma data que ainda não têm retorno registrado."""
    from datetime import timedelta as td
    target = date or (datetime.now(timezone.utc) - td(days=1)).strftime("%Y-%m-%d")
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "is_scheduled": True,
        "start_date": {"$regex": f"^{target}"},
    }).to_list(500)
    result = []
    for p in projects:
        returns = p.get("daily_returns", [])
        has_return = any(r.get("date") == target for r in returns)
        if not has_return and p.get("execution_status") not in ("concluido", "cancelado"):
            result.append(build_project_response(p).model_dump() | {"target_date": target})
    return result

# ============ Dashboard KPIs ============
@api_router.get("/dashboard/kpis")
async def dashboard_kpis(current_user: dict = Depends(get_current_user)):
    from datetime import timedelta as td
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    tomorrow = (now + td(days=1)).strftime("%Y-%m-%d")
    month_start = now.strftime("%Y-%m-01")
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(5000)

    def date_str(v): return (v or "")[:10]
    in_andamento = [p for p in projects if p.get("execution_status") in ("programado", "em_execucao")]
    concluidas_mes = [p for p in projects if p.get("execution_status") in ("executada", "concluido") and date_str(p.get("execution_finished_at") or p.get("end_date") or "") >= month_start]
    atrasadas = [p for p in projects if p.get("end_date") and date_str(p["end_date"]) < today and p.get("execution_status") not in ("executada", "concluido", "cancelado")]
    no_prazo = [p for p in projects if p.get("end_date") and date_str(p["end_date"]) >= today and p.get("execution_status") not in ("cancelado",)]
    vencendo_amanha = [p for p in projects if p.get("end_date") and date_str(p["end_date"]) == tomorrow and p.get("execution_status") not in ("executada", "concluido", "cancelado")]
    vencidas = atrasadas

    total = len(projects)
    concluidas_all = [p for p in projects if p.get("execution_status") in ("executada", "concluido")]
    perc_conclusao = round(100 * len(concluidas_all) / total, 1) if total else 0

    valor_faturado = sum((p.get("billing_value") or 0) for p in concluidas_all)
    valor_pendente = sum((p.get("programmed_value") or 0) - (p.get("billing_value") or 0) for p in projects if p.get("execution_status") not in ("cancelado",))
    receita_prevista_mes = sum((p.get("programmed_value") or 0) for p in projects if date_str(p.get("start_date")) >= month_start)
    receita_realizada = sum((p.get("actual_value") or 0) for p in concluidas_all)
    meta_total = sum((p.get("programmed_value") or 0) for p in projects)
    realizado_total = sum((p.get("actual_value") or 0) for p in projects)

    postes = sum((p.get("postes_qty") or 0) for p in projects)
    trafos = sum((p.get("transformadores_qty") or 0) for p in projects)
    km_rede = sum((p.get("km_rede") or 0) for p in projects)
    ligacoes = sum((p.get("ligacoes_novas") or 0) for p in projects)
    religacoes = sum((p.get("religacoes") or 0) for p in projects)
    desligamentos = sum((p.get("desligamentos") or 0) for p in projects)

    # Tempo médio (dias)
    def days_between(a, b):
        try:
            da = datetime.fromisoformat((a or "")[:10])
            db_ = datetime.fromisoformat((b or "")[:10])
            return max(0, (db_ - da).days)
        except Exception:
            return None
    diff_recebimento_programacao = [days_between(p.get("received_date"), p.get("start_date")) for p in projects if p.get("received_date") and p.get("start_date")]
    diff_programacao_execucao = [days_between(p.get("start_date"), p.get("execution_finished_at") or p.get("end_date")) for p in projects if p.get("start_date") and (p.get("execution_finished_at") or p.get("end_date"))]
    diff_execucao_fechamento = [days_between(p.get("execution_finished_at") or p.get("end_date"), p.get("closed_at")) for p in projects if (p.get("execution_finished_at") or p.get("end_date")) and p.get("closed_at")]
    diff_fechamento_faturamento = [days_between(p.get("closed_at"), p.get("billed_at")) for p in projects if p.get("closed_at") and p.get("billed_at")]
    def avg(lst):
        vs = [v for v in lst if v is not None]
        return round(sum(vs) / len(vs), 1) if vs else 0

    # Serviços concluídos por dia (últimos 14 dias)
    from collections import defaultdict
    by_day = defaultdict(int)
    cutoff = (now - td(days=14)).strftime("%Y-%m-%d")
    for p in concluidas_all:
        d = date_str(p.get("execution_finished_at") or p.get("end_date"))
        if d and d >= cutoff:
            by_day[d] += 1
    servicos_por_dia = sorted([{"date": k, "count": v} for k, v in by_day.items()], key=lambda x: x["date"])

    # Dias adiantados (concluídas antes do end_date)
    dias_adiantados = 0
    for p in concluidas_all:
        end = date_str(p.get("end_date"))
        fim = date_str(p.get("execution_finished_at"))
        if end and fim and fim < end:
            d = days_between(fim, end)
            if d: dias_adiantados += d

    return {
        "counts": {
            "total": total,
            "em_andamento": len(in_andamento),
            "concluidas_mes": len(concluidas_mes),
            "atrasadas": len(atrasadas),
            "no_prazo": len(no_prazo),
            "vencidas": len(vencidas),
            "vencendo_amanha": len(vencendo_amanha),
        },
        "financeiro": {
            "perc_conclusao": perc_conclusao,
            "valor_faturado": round(valor_faturado, 2),
            "valor_pendente_faturamento": round(valor_pendente, 2),
            "receita_prevista_mes": round(receita_prevista_mes, 2),
            "receita_realizada": round(receita_realizada, 2),
            "meta_total": round(meta_total, 2),
            "realizado_total": round(realizado_total, 2),
        },
        "operacional": {
            "postes": postes,
            "transformadores": trafos,
            "km_rede": round(km_rede, 2),
            "ligacoes_novas": ligacoes,
            "religacoes": religacoes,
            "desligamentos": desligamentos,
            "dias_adiantados": dias_adiantados,
            "obras_executadas": len(concluidas_all),
        },
        "tempo_medio": {
            "recebimento_programacao": avg(diff_recebimento_programacao),
            "programacao_execucao": avg(diff_programacao_execucao),
            "execucao_fechamento": avg(diff_execucao_fechamento),
            "fechamento_faturamento": avg(diff_fechamento_faturamento),
        },
        "servicos_por_dia": servicos_por_dia,
        "vencidas": [build_project_response(p).model_dump() for p in vencidas[:20]],
        "vencendo_amanha_list": [build_project_response(p).model_dump() for p in vencendo_amanha[:20]],
    }

# Helper for team response
def build_team_response(team: dict) -> TeamResponse:
    return TeamResponse(
        id=str(team["_id"]),
        name=team["name"],
        members=team.get("members", []),
        supervisor=team.get("supervisor", ""),
        member_count=team.get("member_count", len(team.get("members", []))),
        created_at=team["created_at"].isoformat() if hasattr(team["created_at"], 'isoformat') else team["created_at"],
    )

# Team Routes
@api_router.post("/teams", response_model=TeamResponse)
async def create_team(team_data: TeamCreate, current_user: dict = Depends(get_current_user)):
    team_doc = {
        "name": team_data.name,
        "members": team_data.members,
        "supervisor": team_data.supervisor,
        "member_count": team_data.member_count or len(team_data.members),
        "created_at": datetime.now(timezone.utc),
        "user_id": current_user["_id"]
    }
    result = await db.teams.insert_one(team_doc)
    team_doc["_id"] = result.inserted_id
    return build_team_response(team_doc)

@api_router.get("/teams", response_model=List[TeamResponse])
async def get_teams(current_user: dict = Depends(get_current_user)):
    teams = await db.teams.find({"user_id": current_user["_id"]}).to_list(1000)
    return [build_team_response(team) for team in teams]

@api_router.get("/teams/{team_id}", response_model=TeamResponse)
async def get_team(team_id: str, current_user: dict = Depends(get_current_user)):
    team = await db.teams.find_one({"_id": safe_object_id(team_id), "user_id": current_user["_id"]})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return build_team_response(team)

@api_router.put("/teams/{team_id}", response_model=TeamResponse)
async def update_team(team_id: str, team_data: TeamCreate, current_user: dict = Depends(get_current_user)):
    update_data = {
        "name": team_data.name,
        "members": team_data.members,
        "supervisor": team_data.supervisor,
        "member_count": team_data.member_count or len(team_data.members),
    }
    result = await db.teams.update_one(
        {"_id": safe_object_id(team_id), "user_id": current_user["_id"]},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Team not found")
    team = await db.teams.find_one({"_id": safe_object_id(team_id)})
    return build_team_response(team)

@api_router.delete("/teams/{team_id}")
async def delete_team(team_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.teams.delete_one({"_id": safe_object_id(team_id), "user_id": current_user["_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Team not found")
    return {"message": "Team deleted successfully"}

# Helper for project response building
def build_project_response(project: dict) -> ProjectResponse:
    return ProjectResponse(
        id=str(project["_id"]),
        name=project["name"],
        project_code=project.get("project_code", ""),
        tipo_servico=project.get("tipo_servico", ""),
        team_id=project.get("team_id"),
        team_name=project.get("team_name"),
        start_date=project.get("start_date") or "",
        end_date=project.get("end_date") or "",
        programmed_value=project.get("programmed_value", 0.0),
        daily_goal=project.get("daily_goal", 0.0),
        status=project.get("status", "active"),
        priority=project.get("priority", "medium"),
        actual_value=project.get("actual_value", 0.0),
        billing_value=project.get("billing_value", 0.0),
        project_type=project.get("project_type", "anexo_iv"),
        requires_hot_line=project.get("requires_hot_line", False),
        shutdown_info=project.get("shutdown_info", ""),
        location=project.get("location", ""),
        labor_cost=project.get("labor_cost", 0.0),
        material_cost=project.get("material_cost", 0.0),
        material_status=project.get("material_status", "pending"),
        execution_status=project.get("execution_status", "aguardando_programacao"),
        is_scheduled=project.get("is_scheduled", False),
        utm_x=project.get("utm_x", ""),
        utm_y=project.get("utm_y", ""),
        received_date=project.get("received_date", ""),
        expiry_date=project.get("expiry_date", ""),
        reschedule_history=project.get("reschedule_history", []),
        schedule_entries=project.get("schedule_entries", []) or [],
        cancel_reason=project.get("cancel_reason", ""),
        attachments=project.get("attachments", []) or [],
        materials_list=project.get("materials_list", []) or [],
        material_requisitions=project.get("material_requisitions", []) or [],
        billing_stage=project.get("billing_stage", ""),
        billing_history=project.get("billing_history", []) or [],
        invoice_number=project.get("invoice_number", ""),
        invoice_date=project.get("invoice_date", ""),
        invoice_value=project.get("invoice_value", 0.0),
        additional_team_id=project.get("additional_team_id"),
        additional_team_name=project.get("additional_team_name"),
        postes_qty=project.get("postes_qty", 0),
        transformadores_qty=project.get("transformadores_qty", 0),
        km_rede=project.get("km_rede", 0.0),
        ligacoes_novas=project.get("ligacoes_novas", 0),
        religacoes=project.get("religacoes", 0),
        desligamentos=project.get("desligamentos", 0),
        created_at=project["created_at"].isoformat() if hasattr(project["created_at"], 'isoformat') else project["created_at"],
    )

# Project Routes
@api_router.post("/projects", response_model=ProjectResponse)
async def create_project(project_data: ProjectCreate, current_user: dict = Depends(get_current_user)):
    # Uniqueness check for project_code (per user)
    if project_data.project_code and project_data.project_code.strip():
        existing = await db.projects.find_one({
            "user_id": current_user["_id"],
            "project_code": project_data.project_code.strip(),
        })
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Já existe uma obra cadastrada com o código {project_data.project_code}"
            )
    
    project_doc = {
        **project_data.model_dump(),
        "created_at": datetime.now(timezone.utc),
        "user_id": current_user["_id"]
    }
    # Se schedule_entries fornecidas, derivar legacy fields (start_date/end_date/team_id/additional_team_id)
    entries = project_doc.get("schedule_entries") or []
    if entries:
        # ordenar por data ascendente
        entries = sorted([e for e in entries if e.get("date")], key=lambda e: e["date"])
        project_doc["schedule_entries"] = entries
        first = entries[0]
        last = entries[-1]
        project_doc["start_date"] = first.get("date", "")
        project_doc["end_date"] = last.get("date", "")
        first_teams = first.get("team_ids") or []
        first_names = first.get("team_names") or []
        if first_teams:
            project_doc["team_id"] = first_teams[0]
            project_doc["team_name"] = first_names[0] if first_names else ""
            if len(first_teams) > 1:
                project_doc["additional_team_id"] = first_teams[1]
                project_doc["additional_team_name"] = first_names[1] if len(first_names) > 1 else ""
            else:
                project_doc["additional_team_id"] = None
                project_doc["additional_team_name"] = None
    # Auto-set execution_status when scheduling
    if project_doc.get("is_scheduled") and project_doc.get("execution_status") == "aguardando_programacao":
        project_doc["execution_status"] = "programado"
    
    result = await db.projects.insert_one(project_doc)
    project_doc["_id"] = result.inserted_id
    
    if project_doc.get("is_scheduled"):
        recipients_str = os.environ.get("NOTIFICATION_EMAILS", "")
        recipients = [e.strip() for e in recipients_str.split(",") if e.strip()]
        if recipients:
            html = _build_project_email_html(project_doc, "Nova Programação de Obra")
            subject = f"[HAYAH] Programação: {project_doc.get('name','')} - {(project_doc.get('start_date') or '')[:10]}"
            asyncio.create_task(send_email_via_resend(recipients, subject, html))
    
    return build_project_response(project_doc)

@api_router.get("/projects", response_model=List[ProjectResponse])
async def get_projects(
    current_user: dict = Depends(get_current_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[str] = None,
    is_scheduled: Optional[bool] = None,
):
    query = {"user_id": current_user["_id"]}
    if team_id:
        query["team_id"] = team_id
    if is_scheduled is not None:
        query["is_scheduled"] = is_scheduled
    projects = await db.projects.find(query).to_list(1000)
    
    # Filter by date range in Python (since dates are stored as strings)
    if start_date or end_date:
        filtered = []
        for p in projects:
            p_start = p["start_date"][:10]
            p_end = p["end_date"][:10]
            if start_date and p_end < start_date:
                continue
            if end_date and p_start > end_date:
                continue
            filtered.append(p)
        projects = filtered
    
    return [build_project_response(p) for p in projects]

@api_router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return build_project_response(project)

@api_router.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, project_data: ProjectUpdate, current_user: dict = Depends(get_current_user)):
    existing = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")
    
    payload = project_data.model_dump()
    reschedule_reason = payload.pop("reschedule_reason", None)
    update_data = {k: v for k, v in payload.items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    # Se schedule_entries foram enviadas, derivar legacy fields
    entries = update_data.get("schedule_entries")
    if entries is not None:
        entries = sorted([e for e in entries if e.get("date")], key=lambda e: e["date"])
        update_data["schedule_entries"] = entries
        if entries:
            first = entries[0]
            last = entries[-1]
            update_data["start_date"] = first.get("date", "")
            update_data["end_date"] = last.get("date", "")
            first_teams = first.get("team_ids") or []
            first_names = first.get("team_names") or []
            if first_teams:
                update_data["team_id"] = first_teams[0]
                update_data["team_name"] = first_names[0] if first_names else ""
                if len(first_teams) > 1:
                    update_data["additional_team_id"] = first_teams[1]
                    update_data["additional_team_name"] = first_names[1] if len(first_names) > 1 else ""
                else:
                    update_data["additional_team_id"] = None
                    update_data["additional_team_name"] = None
    
    # Check for duplicate project_code if being changed
    new_code = update_data.get("project_code", "").strip() if update_data.get("project_code") is not None else None
    if new_code and new_code != existing.get("project_code", ""):
        dup = await db.projects.find_one({
            "user_id": current_user["_id"],
            "project_code": new_code,
            "_id": {"$ne": safe_object_id(project_id)},
        })
        if dup:
            raise HTTPException(status_code=409, detail=f"Já existe uma obra com o código {new_code}")
    
    # Track reschedule history when dates change
    old_start = existing.get("start_date", "")
    old_end = existing.get("end_date", "")
    new_start = update_data.get("start_date", old_start)
    new_end = update_data.get("end_date", old_end)
    if existing.get("is_scheduled") and (new_start != old_start or new_end != old_end) and old_start:
        history_entry = {
            "old_start": old_start,
            "old_end": old_end,
            "new_start": new_start,
            "new_end": new_end,
            "reason": reschedule_reason or "outro",
            "changed_at": datetime.now(timezone.utc).isoformat(),
            "changed_by": current_user.get("name", ""),
        }
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"reschedule_history": history_entry}}
        )
    
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"]},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")

    # Auto-move to billing pipeline when execution status becomes "concluido"
    new_exec = update_data.get("execution_status")
    old_exec = existing.get("execution_status")
    if new_exec == "concluido" and old_exec != "concluido" and not existing.get("billing_stage"):
        billing_entry = {
            "stage": "recebimento_tecnico",
            "changed_at": datetime.now(timezone.utc).isoformat(),
            "changed_by": current_user.get("name", ""),
            "notes": "Auto-transição por conclusão da obra",
        }
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$set": {"billing_stage": "recebimento_tecnico"}, "$push": {"billing_history": billing_entry}},
        )
    
    project = await db.projects.find_one({"_id": safe_object_id(project_id)})
    return build_project_response(project)


# ============= FATURAMENTO / BILLING PIPELINE =============
BILLING_STAGES = [
    "recebimento_tecnico",
    "em_fechamento",
    "ajuste_material",
    "pendencia_construtiva",
    "aguardando_fiscalizacao",
    "aprovada",
    "digitada",
    "pago",
]

BILLING_STAGE_LABELS = {
    "recebimento_tecnico": "Recebimento Técnico",
    "em_fechamento": "Em Fechamento",
    "ajuste_material": "Ajuste de Material",
    "pendencia_construtiva": "Pendência Construtiva",
    "aguardando_fiscalizacao": "Aguardando Fiscalização",
    "aprovada": "Aprovada",
    "digitada": "Digitada",
    "pago": "Pago",
}


class BillingStageUpdate(BaseModel):
    stage: str
    notes: Optional[str] = ""
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_value: Optional[float] = None


@api_router.put("/projects/{project_id}/billing-stage")
async def update_billing_stage(
    project_id: str,
    body: BillingStageUpdate,
    current_user: dict = Depends(get_current_user),
):
    if body.stage not in BILLING_STAGES:
        raise HTTPException(status_code=400, detail=f"Estágio inválido. Válidos: {BILLING_STAGES}")
    existing = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Obra não encontrada")

    updates = {"billing_stage": body.stage}
    if body.invoice_number is not None:
        updates["invoice_number"] = body.invoice_number
    if body.invoice_date is not None:
        updates["invoice_date"] = body.invoice_date
    if body.invoice_value is not None:
        updates["invoice_value"] = body.invoice_value

    entry = {
        "stage": body.stage,
        "changed_at": datetime.now(timezone.utc).isoformat(),
        "changed_by": current_user.get("name", ""),
        "notes": body.notes or "",
    }
    await db.projects.update_one(
        {"_id": safe_object_id(project_id)},
        {"$set": updates, "$push": {"billing_history": entry}},
    )
    project = await db.projects.find_one({"_id": safe_object_id(project_id)})
    return build_project_response(project)


@api_router.get("/faturamento/pipeline")
async def billing_pipeline(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Pipeline (esteira) grouped by billing_stage. Filter by billing_stage-change date (from billing_history)."""
    query: dict = {"user_id": current_user["_id"], "billing_stage": {"$ne": ""}}
    projects = await db.projects.find(query).to_list(2000)

    def entered_stage_at(p: dict) -> str:
        # Look at the last billing_history entry for the current stage
        hist = p.get("billing_history") or []
        stage = p.get("billing_stage") or ""
        for h in reversed(hist):
            if h.get("stage") == stage:
                return (h.get("changed_at") or "")[:10]
        return (p.get("start_date") or "")[:10]

    def in_range(iso_date: str) -> bool:
        if not iso_date:
            return True
        if start_date and iso_date < start_date:
            return False
        if end_date and iso_date > end_date:
            return False
        return True

    pipeline: dict = {s: [] for s in BILLING_STAGES}
    totals = {"count": 0, "value": 0.0, "invoiced": 0.0}
    per_stage_totals = {s: {"count": 0, "value": 0.0} for s in BILLING_STAGES}

    for p in projects:
        entered = entered_stage_at(p)
        if not in_range(entered):
            continue
        stage = p.get("billing_stage")
        if stage not in pipeline:
            continue
        val = float(p.get("programmed_value") or 0)
        inv_val = float(p.get("invoice_value") or 0)
        item = {
            "id": str(p["_id"]),
            "project_code": p.get("project_code", ""),
            "name": p.get("name", ""),
            "team_name": p.get("team_name", ""),
            "location": p.get("location", ""),
            "programmed_value": val,
            "invoice_value": inv_val,
            "invoice_number": p.get("invoice_number", ""),
            "invoice_date": p.get("invoice_date", ""),
            "billing_stage": stage,
            "entered_stage_at": entered,
            "requires_hot_line": p.get("requires_hot_line", False),
        }
        pipeline[stage].append(item)
        totals["count"] += 1
        totals["value"] += val
        totals["invoiced"] += inv_val
        per_stage_totals[stage]["count"] += 1
        per_stage_totals[stage]["value"] += val

    # Sort each stage by entered_at ascending (oldest = most stuck)
    for s in pipeline:
        pipeline[s].sort(key=lambda x: x.get("entered_stage_at") or "")

    # Backlog = anything not in "pago"
    backlog_value = sum(per_stage_totals[s]["value"] for s in BILLING_STAGES if s != "pago")
    paid_value = per_stage_totals["pago"]["value"]

    return {
        "pipeline": pipeline,
        "stages": [{"key": k, "label": v} for k, v in BILLING_STAGE_LABELS.items()],
        "totals": totals,
        "per_stage": per_stage_totals,
        "backlog_value": backlog_value,
        "paid_value": paid_value,
    }


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.projects.delete_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"message": "Project deleted successfully"}

# Dashboard Stats
@api_router.get("/dashboard/stats", response_model=DashboardStats)
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(1000)
    teams = await db.teams.find({"user_id": current_user["_id"]}).to_list(1000)
    
    total_projects = len(projects)
    active_projects = len([p for p in projects if p.get("status", "active") == "active"])
    total_programmed = sum(p.get("programmed_value", 0.0) for p in projects)
    total_actual = sum(p.get("actual_value", 0.0) for p in projects)
    total_billing = sum(p.get("billing_value", 0.0) for p in projects)
    total_teams = len(teams)
    
    projects_on_track = 0
    projects_lagging = 0
    
    for project in projects:
        actual = project.get("actual_value", 0.0)
        daily_goal = project.get("daily_goal", 0.0)
        start_date_str = project.get("start_date", "")
        if not start_date_str:
            continue
        
        from datetime import datetime as dt
        try:
            if 'T' in start_date_str:
                start_date = dt.fromisoformat(start_date_str.replace('Z', '+00:00'))
            else:
                start_date = dt.fromisoformat(start_date_str)
            if start_date.tzinfo is None:
                start_date = start_date.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        
        now = datetime.now(timezone.utc)
        days_elapsed = max((now - start_date).days + 1, 1)
        expected_value = daily_goal * days_elapsed
        
        if actual >= expected_value:
            projects_on_track += 1
        else:
            projects_lagging += 1
    
    return DashboardStats(
        total_projects=total_projects,
        active_projects=active_projects,
        total_programmed=total_programmed,
        total_actual=total_actual,
        total_billing=total_billing,
        total_teams=total_teams,
        projects_on_track=projects_on_track,
        projects_lagging=projects_lagging
    )

# Analytics Routes
@api_router.get("/analytics/production")
async def get_production_analytics(
    current_user: dict = Depends(get_current_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[str] = None,
):
    """Returns production data grouped by team and by project type"""
    query = {"user_id": current_user["_id"]}
    if team_id:
        query["team_id"] = team_id
    projects = await db.projects.find(query).to_list(1000)
    
    # Filter by date range
    if start_date or end_date:
        filtered = []
        for p in projects:
            p_start = (p.get("start_date") or "")[:10]
            p_end = (p.get("end_date") or "")[:10]
            if not p_start and not p_end:
                continue  # skip unscheduled projects
            if start_date and p_end and p_end < start_date:
                continue
            if end_date and p_start and p_start > end_date:
                continue
            filtered.append(p)
        projects = filtered
    
    # Group by team
    by_team = {}
    for p in projects:
        team_name = p.get("team_name") or "Sem equipe"
        if team_name not in by_team:
            by_team[team_name] = {"team": team_name, "programmed": 0, "actual": 0, "billing": 0, "count": 0}
        by_team[team_name]["programmed"] += p.get("programmed_value", 0)
        by_team[team_name]["actual"] += p.get("actual_value", 0)
        by_team[team_name]["billing"] += p.get("billing_value", 0)
        by_team[team_name]["count"] += 1
    
    # Group by project type
    type_labels = PROJECT_TYPE_LABELS
    by_type = {}
    for p in projects:
        pt = p.get("project_type", "anexo_iv")
        label = type_labels.get(pt, pt)
        if label not in by_type:
            by_type[label] = {"type": label, "programmed": 0, "actual": 0, "billing": 0, "count": 0}
        by_type[label]["programmed"] += p.get("programmed_value", 0)
        by_type[label]["actual"] += p.get("actual_value", 0)
        by_type[label]["billing"] += p.get("billing_value", 0)
        by_type[label]["count"] += 1
    
    # Execution status breakdown
    exec_labels = {
        "aguardando_inicio": "Aguardando Início",
        "programado": "Programado",
        "em_execucao": "Em Execução",
        "concluido": "Concluído",
        "cancelado": "Cancelado",
    }
    by_status = {}
    for label in exec_labels.values():
        by_status[label] = 0
    for p in projects:
        st = p.get("execution_status", "aguardando_inicio")
        label = exec_labels.get(st, st)
        by_status[label] = by_status.get(label, 0) + 1
    
    # Hot line breakdown
    hot_line_count = len([p for p in projects if p.get("requires_hot_line")])
    
    return {
        "by_team": list(by_team.values()),
        "by_type": list(by_type.values()),
        "by_status": by_status,
        "hot_line_count": hot_line_count,
        "total_projects": len(projects),
    }

# Schedule stats endpoint (matriz programada)
@api_router.get("/schedule/stats")
async def get_schedule_stats(
    current_user: dict = Depends(get_current_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[str] = None,
):
    """Stats for programação (only scheduled projects)"""
    query = {"user_id": current_user["_id"], "is_scheduled": True}
    if team_id:
        query["team_id"] = team_id
    projects = await db.projects.find(query).to_list(1000)
    
    if start_date or end_date:
        filtered = []
        for p in projects:
            p_start = (p.get("start_date") or "")[:10]
            p_end = (p.get("end_date") or "")[:10]
            if not p_start:
                continue
            if start_date and p_end and p_end < start_date:
                continue
            if end_date and p_start > end_date:
                continue
            filtered.append(p)
        projects = filtered
    
    counts = {label: 0 for label in EXECUTION_STATUS_LABELS.values()}
    for p in projects:
        st = p.get("execution_status", "aguardando_inicio")
        counts[EXECUTION_STATUS_LABELS.get(st, st)] = counts.get(EXECUTION_STATUS_LABELS.get(st, st), 0) + 1
    
    total_programmed = sum(p.get("programmed_value", 0.0) for p in projects)
    total_billing = sum(p.get("billing_value", 0.0) for p in projects)
    total_labor = sum(p.get("labor_cost", 0.0) for p in projects)
    total_material = sum(p.get("material_cost", 0.0) for p in projects)
    
    return {
        "total_programmed": total_programmed,
        "total_billing": total_billing,
        "total_labor": total_labor,
        "total_material": total_material,
        "counts": counts,
        "total_projects": len(projects),
    }

# Extended analytics (monthly, cycle)
@api_router.get("/analytics/advanced")
async def get_advanced_analytics(current_user: dict = Depends(get_current_user)):
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(1000)
    
    # Monthly production
    from collections import defaultdict
    monthly = defaultdict(lambda: {"programmed": 0, "actual": 0, "billing": 0})
    for p in projects:
        sd = p.get("start_date") or ""
        if len(sd) >= 7:
            month = sd[:7]
            monthly[month]["programmed"] += p.get("programmed_value", 0)
            monthly[month]["actual"] += p.get("actual_value", 0)
            monthly[month]["billing"] += p.get("billing_value", 0)
    
    monthly_list = [
        {"month": m, **v} for m, v in sorted(monthly.items())
    ]
    
    # Productivity by team (actual / programmed)
    team_perf = {}
    for p in projects:
        team_name = p.get("team_name") or "Sem equipe"
        if team_name not in team_perf:
            team_perf[team_name] = {"team": team_name, "programmed": 0, "actual": 0, "billing": 0, "labor": 0, "material": 0, "count": 0}
        team_perf[team_name]["programmed"] += p.get("programmed_value", 0)
        team_perf[team_name]["actual"] += p.get("actual_value", 0)
        team_perf[team_name]["billing"] += p.get("billing_value", 0)
        team_perf[team_name]["labor"] += p.get("labor_cost", 0)
        team_perf[team_name]["material"] += p.get("material_cost", 0)
        team_perf[team_name]["count"] += 1
    
    for t in team_perf.values():
        t["productivity"] = round((t["actual"] / t["programmed"] * 100) if t["programmed"] else 0, 1)
    
    return {
        "monthly": monthly_list,
        "team_performance": list(team_perf.values()),
    }

# Excel export
from fastapi.responses import StreamingResponse

@api_router.get("/reports/excel")
async def export_excel(
    current_user: dict = Depends(get_current_user),
    report_type: str = "programacao",  # programacao | carteira | producao | faturamento
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[str] = None,
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    
    query = {"user_id": current_user["_id"]}
    if team_id:
        query["team_id"] = team_id
    if report_type == "programacao":
        query["is_scheduled"] = True
    projects = await db.projects.find(query).to_list(1000)
    
    if start_date or end_date:
        filtered = []
        for p in projects:
            p_start = (p.get("start_date") or "")[:10]
            p_end = (p.get("end_date") or "")[:10]
            if start_date and p_end and p_end < start_date:
                continue
            if end_date and p_start and p_start > end_date:
                continue
            filtered.append(p)
        projects = filtered
    
    wb = Workbook()
    ws = wb.active
    ws.title = report_type.capitalize()
    
    headers = [
        "Nome", "Tipo", "Equipe", "Localidade", "Início", "Fim",
        "Valor Programado", "Mão de Obra", "Material", "Prod. Realizada",
        "Faturamento", "Status Execução", "Material", "Linha Viva", "Desligamento", "Prioridade"
    ]
    ws.append(headers)
    header_fill = PatternFill(start_color="000000", end_color="000000", fill_type="solid")
    header_font = Font(bold=True, color="E0FF00")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    for p in projects:
        ws.append([
            p.get("name", ""),
            PROJECT_TYPE_LABELS.get(p.get("project_type"), p.get("project_type", "")),
            p.get("team_name", "") or "-",
            p.get("location", "") or "-",
            (p.get("start_date") or "")[:10],
            (p.get("end_date") or "")[:10],
            p.get("programmed_value", 0),
            p.get("labor_cost", 0),
            p.get("material_cost", 0),
            p.get("actual_value", 0),
            p.get("billing_value", 0),
            EXECUTION_STATUS_LABELS.get(p.get("execution_status"), p.get("execution_status", "")),
            {"complete": "Total", "partial": "Parcial", "pending": "Pendente"}.get(p.get("material_status"), p.get("material_status", "")),
            "Sim" if p.get("requires_hot_line") else "Não",
            p.get("shutdown_info", "") or "-",
            {"high": "Alta", "medium": "Média", "low": "Baixa"}.get(p.get("priority"), p.get("priority", "")),
        ])
    
    # Auto-size columns
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_len:
                    max_len = len(str(cell.value))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max_len + 3, 40)
    
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    
    filename = f"hayah_{report_type}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

# Email helper
async def send_email_via_resend(recipients: List[str], subject: str, html_content: str) -> dict:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[EMAIL SKIPPED - No RESEND_API_KEY] To={recipients} Subject={subject}")
        return {"status": "skipped", "reason": "no_api_key"}
    try:
        import resend
        resend.api_key = api_key
        sender = os.environ.get("SENDER_EMAIL", "Hayah Energy <onboarding@resend.dev>")
        params = {
            "from": sender,
            "to": recipients,
            "subject": subject,
            "html": html_content,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"Email sent to {recipients}: id={result.get('id')}")
        return {"status": "sent", "id": result.get("id")}
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return {"status": "error", "error": str(e)}

def _build_project_email_html(project: dict, title: str) -> str:
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #050505; color: #ffffff; padding: 24px;">
      <table width="100%" style="border-collapse: collapse;">
        <tr><td style="padding-bottom: 24px;">
          <h1 style="color: #E0FF00; margin: 0; font-size: 24px;">HAYAH ENERGY</h1>
          <p style="color: #a1a1aa; margin: 4px 0 0; font-size: 12px; letter-spacing: 3px;">EXCELÊNCIA OPERACIONAL</p>
        </td></tr>
        <tr><td style="border-top: 1px solid #333; padding-top: 24px;">
          <h2 style="color: #00F0FF; margin: 0 0 16px;">{title}</h2>
        </td></tr>
        <tr><td>
          <table width="100%" style="border-collapse: collapse; margin-top: 12px;">
            <tr><td style="padding: 8px 0; color: #a1a1aa; width: 40%;">Projeto:</td><td style="color: #fff; font-weight: bold;">{project.get('name','')}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Tipo:</td><td style="color: #fff;">{PROJECT_TYPE_LABELS.get(project.get('project_type'), project.get('project_type',''))}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Localidade:</td><td style="color: #fff;">{project.get('location','') or '-'}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Equipe:</td><td style="color: #fff;">{project.get('team_name','') or '-'}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Período:</td><td style="color: #fff;">{(project.get('start_date') or '')[:10]} → {(project.get('end_date') or '')[:10]}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Valor Programado:</td><td style="color: #39FF14; font-weight: bold;">R$ {project.get('programmed_value',0):,.2f}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Linha Viva:</td><td style="color: {'#FF5E00' if project.get('requires_hot_line') else '#fff'};">{'SIM ⚡' if project.get('requires_hot_line') else 'Não'}</td></tr>
            <tr><td style="padding: 8px 0; color: #a1a1aa;">Desligamento:</td><td style="color: #fff;">{project.get('shutdown_info','') or '-'}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding-top: 32px; border-top: 1px solid #333; margin-top: 24px;">
          <p style="color: #71717a; font-size: 11px; margin: 0;">Este e-mail foi gerado automaticamente pelo sistema Hayah Energy - Matriz de Programação.</p>
        </td></tr>
      </table>
    </div>
    """

@api_router.post("/schedule/{project_id}/notify")
async def notify_scheduling(project_id: str, current_user: dict = Depends(get_current_user)):
    """Send email notification about project scheduling to configured recipients"""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    recipients_str = os.environ.get("NOTIFICATION_EMAILS", "")
    recipients = [e.strip() for e in recipients_str.split(",") if e.strip()]
    if not recipients:
        return {"status": "no_recipients"}
    
    html = _build_project_email_html(project, "Programação de Obra")
    subject = f"[HAYAH] Programação: {project.get('name','')} - {(project.get('start_date') or '')[:10]}"
    return await send_email_via_resend(recipients, subject, html)

async def daily_scheduled_email_job():
    """Runs daily at 18:00 to send tomorrow's scheduled projects"""
    from datetime import date, timedelta as td
    tomorrow = (datetime.now(timezone.utc) + td(days=1)).strftime("%Y-%m-%d")
    
    recipients_str = os.environ.get("NOTIFICATION_EMAILS", "")
    recipients = [e.strip() for e in recipients_str.split(",") if e.strip()]
    if not recipients:
        logger.info("Daily email job: no NOTIFICATION_EMAILS configured, skipping")
        return
    
    # Find all users' scheduled projects for tomorrow
    projects = await db.projects.find({
        "is_scheduled": True,
        "start_date": {"$regex": f"^{tomorrow}"},
    }).to_list(1000)
    
    if not projects:
        logger.info(f"Daily email job: no projects scheduled for {tomorrow}")
        return
    
    rows = ""
    for p in projects:
        hot = "⚡ SIM" if p.get("requires_hot_line") else "-"
        rows += f"""
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #333; color: #fff;">{p.get('name','')}</td>
          <td style="padding: 12px; border-bottom: 1px solid #333; color: #a1a1aa;">{PROJECT_TYPE_LABELS.get(p.get('project_type'), p.get('project_type',''))}</td>
          <td style="padding: 12px; border-bottom: 1px solid #333; color: #a1a1aa;">{p.get('team_name','') or '-'}</td>
          <td style="padding: 12px; border-bottom: 1px solid #333; color: #a1a1aa;">{p.get('location','') or '-'}</td>
          <td style="padding: 12px; border-bottom: 1px solid #333; color: #FF5E00;">{hot}</td>
        </tr>
        """
    
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #050505; color: #fff; padding: 24px;">
      <h1 style="color: #E0FF00;">HAYAH ENERGY</h1>
      <h2 style="color: #00F0FF;">Programação de Amanhã ({tomorrow})</h2>
      <table width="100%" style="border-collapse: collapse; margin-top: 16px;">
        <thead>
          <tr style="background: #111;">
            <th style="padding: 12px; text-align: left; color: #E0FF00;">Projeto</th>
            <th style="padding: 12px; text-align: left; color: #E0FF00;">Tipo</th>
            <th style="padding: 12px; text-align: left; color: #E0FF00;">Equipe</th>
            <th style="padding: 12px; text-align: left; color: #E0FF00;">Localidade</th>
            <th style="padding: 12px; text-align: left; color: #E0FF00;">Linha Viva</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="color: #71717a; font-size: 11px; margin-top: 24px;">E-mail automático - Hayah Energy Sistema de Programação.</p>
    </div>
    """
    subject = f"[HAYAH] Programação de Amanhã ({tomorrow}) - {len(projects)} obra(s)"
    await send_email_via_resend(recipients, subject, html)

# Manual trigger for daily email (útil para testes)
@api_router.post("/schedule/notify-tomorrow")
async def trigger_tomorrow_email(current_user: dict = Depends(get_current_user)):
    await daily_scheduled_email_job()
    return {"status": "triggered"}

# Anexo IV D-2 reminder
async def anexo_iv_reminder_job():
    """Runs daily at 09:00 America/Cuiaba - alerts Anexo IV projects starting in 2 days"""
    from datetime import timedelta as td
    target = (datetime.now(timezone.utc) + td(days=2)).strftime("%Y-%m-%d")
    projects = await db.projects.find({
        "project_type": "anexo_iv",
        "is_scheduled": True,
        "start_date": {"$regex": f"^{target}"},
        "execution_status": {"$nin": ["concluido", "cancelado", "executada"]},
    }).to_list(500)
    if not projects:
        logger.info(f"Anexo IV reminder: no projects for {target}")
        return
    recipients_str = os.environ.get("NOTIFICATION_EMAILS", "")
    recipients = [e.strip() for e in recipients_str.split(",") if e.strip()]
    rows = ""
    for p in projects:
        rows += f"""
        <tr>
          <td style="padding:10px;border-bottom:1px solid #333;color:#fff;">{p.get('project_code','') or '-'}</td>
          <td style="padding:10px;border-bottom:1px solid #333;color:#fff;">{p.get('name','')}</td>
          <td style="padding:10px;border-bottom:1px solid #333;color:#a1a1aa;">{p.get('team_name','') or '-'}</td>
          <td style="padding:10px;border-bottom:1px solid #333;color:#a1a1aa;">{p.get('location','') or '-'}</td>
          <td style="padding:10px;border-bottom:1px solid #333;color:#FF5E00;">{(p.get('start_date') or '')[:10]}</td>
        </tr>
        """
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;background:#050505;color:#fff;padding:24px;">
      <h1 style="color:#E0FF00;margin:0;">HAYAH ENERGY</h1>
      <h2 style="color:#FF5E00;margin:8px 0 16px;">⚠️ LEMBRETE ANEXO IV — 2 DIAS ATÉ EXECUÇÃO ({target})</h2>
      <p style="color:#a1a1aa;font-size:13px;">Garanta equipe, acesso ao local e materiais para as obras abaixo:</p>
      <table width="100%" style="border-collapse:collapse;margin-top:12px;">
        <thead><tr style="background:#111;">
          <th style="padding:10px;color:#E0FF00;text-align:left;">Código</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Obra</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Equipe</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Localidade</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Início</th>
        </tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="color:#71717a;font-size:11px;margin-top:24px;">Sistema Hayah — Lembrete automático D-2 para Anexo IV.</p>
    </div>"""
    if recipients:
        await send_email_via_resend(recipients, f"[HAYAH] ⚠️ Anexo IV D-2: {len(projects)} obra(s) em {target}", html)

    # Push broadcast
    try:
        await broadcast_push(db, {
            "title": f"⚠️ Anexo IV D-2 — {target}",
            "body": f"{len(projects)} obra(s) começam em 2 dias. Garanta equipe, acesso e materiais.",
            "url": "/programacao",
            "tag": "anexo-iv-d2",
        })
    except Exception as e:
        logger.warning(f"Push broadcast failed: {e}")

@api_router.get("/alerts/anexo-iv")
async def get_anexo_iv_alerts(current_user: dict = Depends(get_current_user)):
    """Return Anexo IV projects starting in the next 2 days (for dashboard banner)"""
    from datetime import timedelta as td
    now = datetime.now(timezone.utc)
    d1 = (now + td(days=1)).strftime("%Y-%m-%d")
    d2 = (now + td(days=2)).strftime("%Y-%m-%d")
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "project_type": "anexo_iv",
        "is_scheduled": True,
        "execution_status": {"$nin": ["concluido", "cancelado", "executada"]},
        "$or": [
            {"start_date": {"$regex": f"^{d1}"}},
            {"start_date": {"$regex": f"^{d2}"}},
        ],
    }).to_list(500)
    return [build_project_response(p).model_dump() for p in projects]

@api_router.post("/schedule/anexo-iv-reminder")
async def trigger_anexo_iv_reminder(current_user: dict = Depends(get_current_user)):
    await anexo_iv_reminder_job()
    return {"status": "triggered"}

# --- Checklist Operacional endpoints (Iteração 7) ---
class ChecklistUpdate(BaseModel):
    hotline_confirmed: Optional[bool] = None
    shutdown_confirmed: Optional[bool] = None
    material_confirmed: Optional[bool] = None
    team_confirmed: Optional[bool] = None
    notes: Optional[str] = None

@api_router.get("/operacional/checklist/{project_id}")
async def get_checklist(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    checklist = project.get("checklist", {})
    photos = project.get("photos", [])
    return {"project_id": project_id, "checklist": checklist, "photos": photos}

@api_router.put("/operacional/checklist/{project_id}")
async def update_checklist(project_id: str, data: ChecklistUpdate, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    checklist = project.get("checklist", {})
    for k, v in data.model_dump(exclude_none=True).items():
        checklist[k] = v
    checklist["updated_at"] = datetime.now(timezone.utc).isoformat()
    checklist["updated_by"] = current_user.get("name", "")
    await db.projects.update_one({"_id": safe_object_id(project_id)}, {"$set": {"checklist": checklist}})
    return {"project_id": project_id, "checklist": checklist}

# Photo upload for operational checklist
@api_router.post("/operacional/photos/{project_id}")
async def upload_photo(
    project_id: str,
    label: str = Form("foto"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 10MB")
    b64 = base64.b64encode(content).decode("ascii")
    data_url = f"data:{file.content_type or 'image/jpeg'};base64,{b64}"
    photo = {
        "id": secrets.token_urlsafe(8),
        "label": label,
        "data_url": data_url,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.projects.update_one({"_id": safe_object_id(project_id)}, {"$push": {"photos": photo}})
    return photo

@api_router.delete("/operacional/photos/{project_id}/{photo_id}")
async def delete_photo(project_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"]},
        {"$pull": {"photos": {"id": photo_id}}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}

# --- Diário de Obra (PDF) ---
@api_router.get("/operacional/daily-log/{project_id}")
async def daily_log_pdf(project_id: str, notes: str = "", current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    checklist = project.get("checklist", {}) or {}
    photos = project.get("photos", []) or []
    pdf_bytes = build_daily_log_pdf(project, checklist, photos, notes)
    filename = f"diario_obra_{(project.get('project_code') or project_id)[:24]}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# --- Web Push Notifications ---
class PushSubscribeBody(BaseModel):
    endpoint: str
    keys: dict

@api_router.get("/push/vapid-key")
async def get_vapid_key(current_user: dict = Depends(get_current_user)):
    keys = await ensure_vapid_keys(db)
    return {"public_key": keys["public_b64u"]}

@api_router.post("/push/subscribe")
async def subscribe_push(body: PushSubscribeBody, current_user: dict = Depends(get_current_user)):
    subscription = {"endpoint": body.endpoint, "keys": body.keys}
    await db.push_subscriptions.update_one(
        {"endpoint": body.endpoint},
        {"$set": {
            "endpoint": body.endpoint,
            "subscription": subscription,
            "user_id": current_user["_id"],
            "user_email": current_user.get("email", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"status": "subscribed"}

@api_router.post("/push/unsubscribe")
async def unsubscribe_push(body: dict, current_user: dict = Depends(get_current_user)):
    await db.push_subscriptions.delete_one({"endpoint": body.get("endpoint", "")})
    return {"status": "unsubscribed"}

@api_router.post("/push/test")
async def send_push_test(current_user: dict = Depends(get_current_user)):
    result = await broadcast_push(db, {
        "title": "Hayah Energy",
        "body": "Notificação de teste — Push funcionando!",
        "url": "/",
    })
    return result

# Morning alert (08:30) for unconfirmed shutdowns
async def morning_shutdown_check_job():
    """Runs daily at 08:30 America/Cuiaba - alerts if projects with hot line or shutdown have unconfirmed checklists"""
    from datetime import datetime as dt
    try:
        from zoneinfo import ZoneInfo
        today = dt.now(ZoneInfo("America/Cuiaba")).strftime("%Y-%m-%d")
    except Exception:
        today = dt.now(timezone.utc).strftime("%Y-%m-%d")
    
    recipients_str = os.environ.get("NOTIFICATION_EMAILS", "")
    recipients = [e.strip() for e in recipients_str.split(",") if e.strip()]
    if not recipients:
        return
    
    projects = await db.projects.find({"is_scheduled": True}).to_list(2000)
    pending = []
    for p in projects:
        ps = (p.get("start_date") or "")[:10]
        pe = (p.get("end_date") or "")[:10]
        if not ps or not (ps <= today <= (pe or ps)):
            continue
        if not (p.get("requires_hot_line") or p.get("shutdown_info")):
            continue
        cl = p.get("checklist", {})
        if p.get("requires_hot_line") and not cl.get("hotline_confirmed"):
            pending.append((p, "Linha Viva não confirmada"))
        elif p.get("shutdown_info") and not cl.get("shutdown_confirmed"):
            pending.append((p, "Desligamento não confirmado"))
    
    if not pending:
        return
    
    rows = "".join([
        f"""<tr>
          <td style="padding:10px;border-bottom:1px solid #333;color:#fff;">{p.get('name','')}</td>
          <td style="padding:10px;border-bottom:1px solid #333;color:#a1a1aa;">{p.get('team_name','') or '-'}</td>
          <td style="padding:10px;border-bottom:1px solid #333;color:#FF003C;">{reason}</td>
        </tr>""" for p, reason in pending
    ])
    html = f"""<div style="font-family:Arial;background:#050505;color:#fff;padding:24px;">
      <h1 style="color:#FF003C;">⚠️ ATENÇÃO — Segurança da Obra</h1>
      <p>Os seguintes projetos programados para hoje ({today}) têm checklists de segurança <b>não confirmados</b>:</p>
      <table width="100%" style="border-collapse:collapse;margin-top:12px;">
        <thead><tr style="background:#111;"><th style="padding:10px;color:#E0FF00;text-align:left;">Projeto</th><th style="padding:10px;color:#E0FF00;text-align:left;">Equipe</th><th style="padding:10px;color:#E0FF00;text-align:left;">Pendência</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="color:#71717a;font-size:11px;margin-top:24px;">HAYAH ENERGY — Sistema de Segurança Operacional</p>
    </div>"""
    await send_email_via_resend(recipients, f"[HAYAH] ⚠️ {len(pending)} checklist(s) de segurança pendente(s)", html)

# Top 10 mais caras (filtro: aguardando_programacao, aguardando_inicio, programado, em_execucao)
@api_router.get("/analytics/top-expensive")
async def top_expensive_projects(current_user: dict = Depends(get_current_user)):
    allowed = ["aguardando_programacao", "aguardando_inicio", "programado", "em_execucao"]
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "execution_status": {"$in": allowed},
    }).to_list(2000)
    projects.sort(key=lambda p: p.get("programmed_value", 0), reverse=True)
    top = projects[:10]
    return [build_project_response(p).model_dump() for p in top]

# Geolocalização: retorna todos os projetos com utm_x/utm_y não vazios
@api_router.get("/geo/projects")
async def geo_projects(current_user: dict = Depends(get_current_user)):
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "utm_x": {"$nin": ["", None]},
        "utm_y": {"$nin": ["", None]},
    }).to_list(2000)
    return [build_project_response(p).model_dump() for p in projects]

class RouteStop(BaseModel):
    order: Optional[int] = None
    project_code: Optional[str] = ""
    name: Optional[str] = ""
    project_type: Optional[str] = ""
    location: Optional[str] = ""
    programmed_value: Optional[float] = 0
    lat: float
    lng: float
    execution_status: Optional[str] = ""

class RouteOrigin(BaseModel):
    label: Optional[str] = ""
    lat: float
    lng: float

class RoutePdfBody(BaseModel):
    team_name: Optional[str] = None
    origin: RouteOrigin
    distance_km: Optional[float] = 0
    duration_min: Optional[float] = 0
    route_mode: Optional[str] = "haversine"
    stops: List[RouteStop]

@api_router.post("/geo/route-pdf")
async def geo_route_pdf(body: RoutePdfBody, current_user: dict = Depends(get_current_user)):
    pdf_bytes = build_route_pdf(body.model_dump())
    filename = f"roteiro_{(body.team_name or 'todas').replace(' ', '_')[:24]}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@api_router.get("/geo/geocode")
async def geo_geocode(q: str = "", limit: int = 5, current_user: dict = Depends(get_current_user)):
    """Proxy geocoding — Photon primário + Nominatim fallback. Cache LRU 60s por (q,limit)."""
    q = (q or "").strip()
    if len(q) < 3:
        return []
    import time
    lim = max(1, min(limit, 10))
    cache_key = f"{q.lower()}|{lim}"
    now = time.time()
    # Evict expired
    for k in list(_geocode_cache.keys()):
        if now - _geocode_cache[k]["ts"] > 60:
            _geocode_cache.pop(k, None)
    hit = _geocode_cache.get(cache_key)
    if hit:
        return hit["data"]
    headers = {
        "User-Agent": "HayahEnergy/1.0 (matriz-programacao; contato@hayahenergy.com.br)",
        "Accept-Language": "pt-BR",
        "Accept": "application/json",
    }
    # Try Photon first (Komoot). Não aceita lang=pt — remover.
    try:
        photon_url = "https://photon.komoot.io/api/"
        photon_params = {"q": q, "limit": lim}
        async with httpx.AsyncClient(timeout=8.0) as http:
            r = await http.get(photon_url, params=photon_params, headers=headers)
        if r.status_code == 200:
            gj = r.json()
            out = []
            for f in (gj.get("features") or []):
                geom = f.get("geometry") or {}
                if geom.get("type") != "Point":
                    continue
                coords = geom.get("coordinates") or []
                if len(coords) < 2:
                    continue
                props = f.get("properties") or {}
                cc = (props.get("countrycode") or "").upper()
                country = (props.get("country") or "").lower()
                if cc and cc != "BR":
                    continue
                if not cc and country and country not in ("brasil", "brazil"):
                    continue
                street = props.get("street") or ""
                number = props.get("housenumber") or ""
                name = props.get("name") or ""
                city = props.get("city") or props.get("locality") or props.get("town") or props.get("village") or props.get("county") or ""
                state = props.get("state") or ""
                country_name = props.get("country") or ""
                street_part = f"{street}{(', '+number) if number else ''}" if street else ""
                pieces = [p for p in [street_part or name, city, state, country_name] if p]
                display = ", ".join(pieces) if pieces else name or f"{coords[1]:.5f}, {coords[0]:.5f}"
                out.append({
                    "display": display,
                    "lat": float(coords[1]),
                    "lng": float(coords[0]),
                    "city": city,
                    "state": state,
                })
            if out:
                _geocode_cache[cache_key] = {"ts": now, "data": out[:lim]}
                return out[:lim]
    except Exception as e:
        logger.warning(f"Photon geocode error: {e}")
    # Nominatim fallback
    try:
        nom_url = "https://nominatim.openstreetmap.org/search"
        nom_params = {"q": q, "format": "json", "addressdetails": 1, "limit": lim, "countrycodes": "br"}
        async with httpx.AsyncClient(timeout=8.0) as http:
            r = await http.get(nom_url, params=nom_params, headers=headers)
        if r.status_code == 200:
            data = r.json()
            out = []
            for it in data:
                addr = it.get("address") or {}
                out.append({
                    "display": it.get("display_name", ""),
                    "lat": float(it.get("lat", 0)),
                    "lng": float(it.get("lon", 0)),
                    "city": addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or "",
                    "state": addr.get("state") or "",
                })
            _geocode_cache[cache_key] = {"ts": now, "data": out}
            return out
        logger.warning(f"Nominatim {r.status_code}")
    except Exception as e:
        logger.warning(f"Nominatim fallback error: {e}")
    return []

# ============ Live Tracking (Rastreio Ao Vivo) ============
class TrackingPing(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None
    team_id: Optional[str] = None
    heading: Optional[float] = None
    speed: Optional[float] = None

@api_router.post("/tracking/ping")
async def tracking_ping(body: TrackingPing, current_user: dict = Depends(get_current_user)):
    """Store a live position ping for the current user."""
    doc = {
        "user_id": current_user["_id"],
        "user_email": current_user.get("email", ""),
        "user_name": current_user.get("name", current_user.get("email", "")),
        "lat": body.lat,
        "lng": body.lng,
        "accuracy": body.accuracy,
        "team_id": body.team_id,
        "heading": body.heading,
        "speed": body.speed,
        "updated_at": datetime.now(timezone.utc),
    }
    await db.tracking_positions.update_one(
        {"user_id": current_user["_id"]},
        {"$set": doc},
        upsert=True,
    )
    return {"status": "ok", "updated_at": doc["updated_at"].isoformat()}

@api_router.get("/tracking/live")
async def tracking_live(current_user: dict = Depends(get_current_user)):
    """List active pings (last 5 minutes) for the current user's teams."""
    from datetime import timedelta as td
    cutoff = datetime.now(timezone.utc) - td(minutes=5)
    docs = await db.tracking_positions.find({"updated_at": {"$gte": cutoff}}).to_list(500)
    # Enrich with team name if available
    team_ids = [d.get("team_id") for d in docs if d.get("team_id")]
    teams = {}
    if team_ids:
        team_docs = await db.teams.find({"_id": {"$in": [safe_object_id(t) for t in team_ids if t]}}).to_list(500)
        for t in team_docs:
            teams[str(t["_id"])] = t.get("name", "")
    out = []
    for d in docs:
        out.append({
            "user_id": d["user_id"],
            "user_email": d.get("user_email", ""),
            "user_name": d.get("user_name", ""),
            "team_id": d.get("team_id"),
            "team_name": teams.get(d.get("team_id") or "", ""),
            "lat": d["lat"],
            "lng": d["lng"],
            "accuracy": d.get("accuracy"),
            "heading": d.get("heading"),
            "speed": d.get("speed"),
            "updated_at": d["updated_at"].isoformat() if isinstance(d["updated_at"], datetime) else d["updated_at"],
        })
    return out

@api_router.delete("/tracking/ping")
async def tracking_stop(current_user: dict = Depends(get_current_user)):
    """Stop sharing: remove current user's position."""
    await db.tracking_positions.delete_one({"user_id": current_user["_id"]})
    return {"status": "stopped"}

# ============ Duplicar Obra (clone) ============
@api_router.post("/projects/{project_id}/duplicate")
async def duplicate_project(project_id: str, current_user: dict = Depends(get_current_user)):
    """Clone a project, clearing scheduling/execution fields and project_code."""
    src = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not src:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    clone = {k: v for k, v in src.items() if k not in ("_id",)}
    clone["name"] = f"{src.get('name', '')} (cópia)"
    clone["project_code"] = ""  # deve ser único
    clone["is_scheduled"] = False
    clone["execution_status"] = "aguardando_programacao"
    clone["scheduled_date"] = ""
    clone["start_date"] = ""
    clone["end_date"] = ""
    clone["actual_value"] = 0
    clone["billing_value"] = 0
    clone["team_id"] = None
    clone["team_name"] = ""
    clone["reschedule_history"] = []
    clone["photos"] = []
    clone["checklist"] = {}
    clone["created_at"] = datetime.now(timezone.utc)
    clone["updated_at"] = datetime.now(timezone.utc)
    result = await db.projects.insert_one(clone)
    new_doc = await db.projects.find_one({"_id": result.inserted_id})
    return build_project_response(new_doc).model_dump()

# Configuração exposta ao frontend
@api_router.get("/config")
async def get_config():
    return {
        "project_types": PROJECT_TYPE_LABELS,
        "tipo_servico": TIPO_SERVICO_LABELS,
        "municipios": MUNICIPIOS,
        "execution_status": EXECUTION_STATUS_LABELS,
        "reschedule_reasons": RESCHEDULE_REASONS,
    }

# Calendar view (matriz por equipe x data)
@api_router.get("/schedule/calendar")
async def get_calendar_view(
    current_user: dict = Depends(get_current_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """Returns calendar grid: rows = teams, columns = dates, cells = list of projects"""
    from datetime import datetime as dt, timedelta as td
    
    # Default: current week (Mon-Sun)
    if not start_date:
        today = dt.now(timezone.utc).date()
        start = today - td(days=today.weekday())
        start_date = start.isoformat()
    if not end_date:
        end = dt.fromisoformat(start_date).date() + td(days=13)
        end_date = end.isoformat()
    
    # Fetch all scheduled projects overlapping with the range
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "is_scheduled": True,
    }).to_list(1000)
    
    teams = await db.teams.find({"user_id": current_user["_id"]}).to_list(1000)
    
    # Generate list of dates
    start_dt = dt.fromisoformat(start_date).date()
    end_dt = dt.fromisoformat(end_date).date()
    dates = []
    d = start_dt
    while d <= end_dt:
        dates.append(d.isoformat())
        d += td(days=1)
    
    # Build grid: {team_id: {date: [projects]}}
    grid = {}
    # Include unassigned team bucket
    team_meta = [{"id": None, "name": "Sem equipe", "supervisor": ""}] + [
        {"id": str(t["_id"]), "name": t["name"], "supervisor": t.get("supervisor", "")}
        for t in teams
    ]
    
    for tm in team_meta:
        grid[tm["id"] or "unassigned"] = {d: [] for d in dates}
    
    for p in projects:
        # Build (date, team_id) pairs from schedule_entries if present, else fallback
        entries = p.get("schedule_entries") or []
        pairs = []  # list of (date_iso, team_id)
        if entries:
            for e in entries:
                d_str = (e.get("date") or "")[:10]
                if not d_str:
                    continue
                team_ids_list = e.get("team_ids") or []
                if not team_ids_list:
                    pairs.append((d_str, None))
                else:
                    for tid in team_ids_list:
                        pairs.append((d_str, tid))
        else:
            ps = (p.get("start_date") or "")[:10]
            pe = (p.get("end_date") or "")[:10]
            if not ps:
                continue
            try:
                p_start = dt.fromisoformat(ps).date()
                p_end = dt.fromisoformat(pe).date() if pe else p_start
            except Exception:
                continue
            legacy_teams = [t for t in [p.get("team_id"), p.get("additional_team_id")] if t]
            if not legacy_teams:
                legacy_teams = [None]
            cursor = p_start
            while cursor <= p_end:
                for tid in legacy_teams:
                    pairs.append((cursor.isoformat(), tid))
                cursor += td(days=1)

        # Filter pairs to visible date range and push to grid
        for date_iso, tid in pairs:
            try:
                d_date = dt.fromisoformat(date_iso).date()
            except Exception:
                continue
            if d_date < start_dt or d_date > end_dt:
                continue
            key = tid or "unassigned"
            if key not in grid:
                grid[key] = {d: [] for d in dates}
            if date_iso not in grid[key]:
                grid[key][date_iso] = []
            grid[key][date_iso].append({
                "id": str(p["_id"]),
                "code": p.get("project_code") or p.get("name", ""),
                "name": p.get("name", ""),
                "execution_status": p.get("execution_status", "aguardando_inicio"),
                "requires_hot_line": p.get("requires_hot_line", False),
                "shutdown_info": p.get("shutdown_info", ""),
                "location": p.get("location", ""),
            })
    
    return {
        "dates": dates,
        "teams": team_meta,
        "grid": grid,
    }

# Operacional do dia (dashboard mobile-friendly)
@api_router.get("/operacional/today")
async def get_today_operations(current_user: dict = Depends(get_current_user)):
    """Projects scheduled for today - grouped by team for the encarregado"""
    from datetime import datetime as dt
    try:
        from zoneinfo import ZoneInfo
        today = dt.now(ZoneInfo("America/Cuiaba")).strftime("%Y-%m-%d")
    except Exception:
        today = dt.now(timezone.utc).strftime("%Y-%m-%d")
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "is_scheduled": True,
    }).to_list(1000)
    
    # Filter to today's projects (in date range)
    today_projects = []
    for p in projects:
        ps = (p.get("start_date") or "")[:10]
        pe = (p.get("end_date") or "")[:10]
        if not ps:
            continue
        if ps <= today <= (pe or ps):
            today_projects.append(p)
    
    # Group by team
    grouped = {}
    for p in today_projects:
        team_name = p.get("team_name") or "Sem equipe"
        if team_name not in grouped:
            grouped[team_name] = []
        grouped[team_name].append(build_project_response(p).model_dump())
    
    total_value = sum(p.get("programmed_value", 0) for p in today_projects)
    hot_line_count = sum(1 for p in today_projects if p.get("requires_hot_line"))
    
    return {
        "date": today,
        "total_projects": len(today_projects),
        "total_value": total_value,
        "hot_line_count": hot_line_count,
        "by_team": grouped,
    }

# Material request with PDF attachments

@api_router.post("/projects/{project_id}/attachments")
async def upload_project_attachment(
    project_id: str,
    kind: str = Form("project_pdf"),  # project_pdf | material_pdf | other
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 25MB")
    fname = file.filename or "arquivo"
    ext = (fname.rsplit(".", 1)[-1] or "bin").lower() if "." in fname else "bin"
    path = f"{APP_NAME}/projects/{current_user['_id']}/{uuid.uuid4()}.{ext}"
    result = await storage_put(path, content, file.content_type or "application/octet-stream")
    att = {
        "id": secrets.token_urlsafe(10),
        "kind": kind,
        "filename": fname,
        "size": result.get("size", len(content)),
        "content_type": file.content_type or "application/octet-stream",
        "storage_path": result["path"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": current_user.get("name", ""),
        "is_deleted": False,
    }
    await db.projects.update_one(
        {"_id": safe_object_id(project_id)},
        {"$push": {"attachments": att}}
    )
    return att


@api_router.get("/projects/{project_id}/attachments/{att_id}")
async def download_project_attachment(
    project_id: str,
    att_id: str,
    auth: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    atts = project.get("attachments", []) or []
    att = next((a for a in atts if a.get("id") == att_id and not a.get("is_deleted")), None)
    if not att:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    data, ct = await storage_get(att["storage_path"])
    return Response(
        content=data,
        media_type=att.get("content_type") or ct,
        headers={"Content-Disposition": f'inline; filename="{att.get("filename","arquivo.pdf")}"'},
    )


@api_router.delete("/projects/{project_id}/attachments/{att_id}")
async def delete_project_attachment(
    project_id: str,
    att_id: str,
    current_user: dict = Depends(get_current_user),
):
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"], "attachments.id": att_id},
        {"$set": {"attachments.$.is_deleted": True, "attachments.$.deleted_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    return {"status": "deleted", "id": att_id}


@api_router.post("/projects/{project_id}/materials-import")
async def import_materials_list(
    project_id: str,
    file: UploadFile = File(...),
    replace: bool = Form(False),
    current_user: dict = Depends(get_current_user),
):
    """Import material list from Excel (.xlsx) or CSV (.csv). 
    Expected columns (flexible names): item/descricao/material, quantidade/qtd, unidade/un, preco/valor/custo."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 10MB")
    fname = (file.filename or "").lower()
    rows: List[dict] = []
    try:
        if fname.endswith(".csv") or (file.content_type or "").startswith("text/csv"):
            import csv as _csv
            text = content.decode("utf-8-sig", errors="ignore")
            reader = _csv.DictReader(io.StringIO(text), delimiter=";" if text.count(";") > text.count(",") else ",")
            rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in reader]
        else:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(content), data_only=True)
            ws = wb.active
            headers = [str(c.value or "").strip().lower() for c in next(ws.iter_rows(min_row=1, max_row=1))]
            for r in ws.iter_rows(min_row=2, values_only=True):
                if not any(v not in (None, "") for v in r):
                    continue
                d = {}
                for i, v in enumerate(r):
                    if i < len(headers) and headers[i]:
                        d[headers[i]] = str(v).strip() if v is not None else ""
                rows.append(d)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao ler planilha: {e}")

    def pick(d: dict, *keys):
        for k in keys:
            for actual, val in d.items():
                if actual and (actual == k or k in actual):
                    return val
        return ""

    def to_float(v) -> float:
        s = str(v or "").strip()
        if not s:
            return 0.0
        # Handle both BR (1.234,56) and US (1,234.56) formats intelligently
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):
                s = s.replace(".", "").replace(",", ".")  # BR
            else:
                s = s.replace(",", "")  # US
        elif "," in s:
            s = s.replace(",", ".")
        try:
            return float(s)
        except Exception:
            return 0.0

    def to_int(v) -> int:
        f = to_float(v)
        return int(f)

    normalized = []
    for r in rows:
        item = pick(r, "item", "descricao", "material", "descrição", "produto")
        if not item:
            continue
        qty = to_float(pick(r, "quantidade", "qtd", "quant"))
        qty_out = int(qty) if qty == int(qty) else qty
        unit = pick(r, "unidade", "un", "unid")
        cost = to_float(pick(r, "preco", "valor", "custo", "preço", "vlr"))
        normalized.append({
            "id": secrets.token_urlsafe(8),
            "item": str(item),
            "quantity": qty_out,
            "unit": str(unit) or "un",
            "unit_cost": cost,
            "total_cost": round(cost * qty, 2),
        })

    if not normalized:
        raise HTTPException(status_code=400, detail="Nenhum item válido encontrado. Verifique colunas: item/descricao, quantidade, unidade, preco.")

    if replace:
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$set": {"materials_list": normalized}}
        )
        final = normalized
    else:
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"materials_list": {"$each": normalized}}}
        )
        proj2 = await db.projects.find_one({"_id": safe_object_id(project_id)})
        final = proj2.get("materials_list", [])
    total = sum((it.get("total_cost") or 0.0) for it in final)
    return {"imported": len(normalized), "total_items": len(final), "estimated_cost": total, "items": final}


# Material request with PDF attachments

@api_router.patch("/projects/{project_id}/materials/{item_id}")
async def update_material_item(
    project_id: str,
    item_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update quantity fields on a material item: qty_requested, qty_separated, qty_written_off, qty_delivered"""
    allowed = {"qty_requested", "qty_separated", "qty_written_off", "qty_delivered", "notes"}
    updates = {}
    for k, v in body.items():
        if k in allowed:
            try:
                updates[f"materials_list.$.{k}"] = float(v) if k != "notes" else str(v)
            except Exception:
                updates[f"materials_list.$.{k}"] = 0
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo válido")
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"], "materials_list.id": item_id},
        {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    return {"status": "updated", "id": item_id, "updates": updates}


@api_router.post("/materials/request")
async def request_materials(
    current_user: dict = Depends(get_current_user),
    project_id: str = Form(...),
    notes: str = Form(""),
    signature_name: str = Form(""),
    material_pdf: Optional[UploadFile] = File(None),
    project_pdf: Optional[UploadFile] = File(None),
):
    """Send material request email to warehouse with PDF attachments + material list table."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    warehouse_email = os.environ.get("WAREHOUSE_EMAIL", "").strip()
    fallback_emails = os.environ.get("NOTIFICATION_EMAILS", "")
    if warehouse_email:
        recipients = [e.strip() for e in warehouse_email.replace(";", ",").split(",") if e.strip()]
    else:
        recipients = [e.strip() for e in fallback_emails.replace(";", ",").split(",") if e.strip()]
    
    if not recipients:
        raise HTTPException(status_code=400, detail="Nenhum destinatário configurado")
    
    # Read attachments from upload
    attachments = []
    if material_pdf:
        content = await material_pdf.read()
        attachments.append({
            "filename": material_pdf.filename or "lista_materiais.pdf",
            "content": list(content),
        })
    if project_pdf:
        content = await project_pdf.read()
        attachments.append({
            "filename": project_pdf.filename or "projeto.pdf",
            "content": list(content),
        })
    
    # Include stored project PDF attachments as email attachments
    stored_atts = [a for a in (project.get("attachments") or []) if not a.get("is_deleted")]
    for a in stored_atts[:5]:  # limit 5
        try:
            data, _ = await storage_get(a["storage_path"])
            attachments.append({
                "filename": a.get("filename") or "anexo.pdf",
                "content": list(data),
            })
        except Exception:
            pass
    
    # Build material list HTML from project.materials_list
    materials = project.get("materials_list", []) or []
    materials_rows = ""
    total_solicitado = 0
    total_separado = 0
    total_baixado = 0
    total_entregue = 0
    for m in materials:
        qs = m.get("qty_requested", m.get("quantity", 0)) or 0
        qsep = m.get("qty_separated", 0) or 0
        qbx = m.get("qty_written_off", 0) or 0
        qent = m.get("qty_delivered", 0) or 0
        total_solicitado += qs
        total_separado += qsep
        total_baixado += qbx
        total_entregue += qent
        materials_rows += f"""
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">{m.get('item','')}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:center;">{m.get('unit','un')}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;font-weight:bold;">{qs}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;color:#00A050;">{qsep}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;color:#FF5E00;">{qbx}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;color:#005EE0;font-weight:bold;">{qent}</td>
        </tr>"""

    materials_table = f"""
    <h3 style="color:#00F0FF;margin-top:24px;margin-bottom:8px;">Lista de Materiais ({len(materials)} itens)</h3>
    <table width="100%" style="border-collapse:collapse;background:#fff;color:#050505;font-size:12px;border:1px solid #ddd;">
      <thead>
        <tr style="background:#050505;color:#E0FF00;">
          <th style="padding:6px 8px;text-align:left;">Item</th>
          <th style="padding:6px 8px;">Un</th>
          <th style="padding:6px 8px;text-align:right;">Solicitado</th>
          <th style="padding:6px 8px;text-align:right;">Separado</th>
          <th style="padding:6px 8px;text-align:right;">Baixado</th>
          <th style="padding:6px 8px;text-align:right;">Entregue</th>
        </tr>
      </thead>
      <tbody>{materials_rows}</tbody>
      <tfoot>
        <tr style="background:#f5f5f5;font-weight:bold;">
          <td colspan="2" style="padding:6px 8px;text-align:right;">TOTAIS</td>
          <td style="padding:6px 8px;text-align:right;">{total_solicitado}</td>
          <td style="padding:6px 8px;text-align:right;color:#00A050;">{total_separado}</td>
          <td style="padding:6px 8px;text-align:right;color:#FF5E00;">{total_baixado}</td>
          <td style="padding:6px 8px;text-align:right;color:#005EE0;">{total_entregue}</td>
        </tr>
      </tfoot>
    </table>
    """ if materials else ""

    signature_block = ""
    if signature_name:
        signature_block = f"""
        <div style="margin-top:28px;padding:16px;border-top:2px dashed #333;">
          <p style="font-size:11px;color:#a1a1aa;margin:0;">Solicitado e assinado por:</p>
          <p style="font-size:16px;color:#fff;margin:6px 0 0 0;font-weight:bold;">{signature_name}</p>
        </div>
        """

    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #E0FF00; background: #050505; padding: 16px; margin: 0;">HAYAH ENERGY</h1>
      <div style="background: #050505; color: #fff; padding: 24px;">
        <h2 style="color: #00F0FF; margin-top: 0;">Solicitação de Material</h2>
        <table width="100%" style="border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #a1a1aa; width: 40%;">Projeto:</td><td style="color: #fff; font-weight: bold;">{project.get('name','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Nº Obra:</td><td style="color: #fff;">{project.get('project_code','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Tipo:</td><td style="color: #fff;">{PROJECT_TYPE_LABELS.get(project.get('project_type'), '')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Localidade:</td><td style="color: #fff;">{project.get('location','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Equipe:</td><td style="color: #fff;">{project.get('team_name','') or '-'}{(' + ' + (project.get('additional_team_name') or '')) if project.get('additional_team_name') else ''}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Período:</td><td style="color: #fff;">{(project.get('start_date') or '')[:10]} → {(project.get('end_date') or '')[:10]}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Solicitado por:</td><td style="color: #fff;">{current_user.get('name','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Data solicitação:</td><td style="color: #fff;">{datetime.now(timezone.utc).astimezone().strftime('%d/%m/%Y %H:%M')}</td></tr>
        </table>
        {'<div style="margin-top: 20px; padding: 12px; background: rgba(255,255,255,0.05); border-left: 3px solid #E0FF00;"><p style="margin: 0; color: #fff;">' + notes + '</p></div>' if notes else ''}
        {materials_table}
        {signature_block}
        <p style="color: #71717a; font-size: 11px; margin-top: 24px;">Anexos: {len(attachments)} arquivo(s)</p>
      </div>
    </div>
    """
    subject = f"[HAYAH] Solicitação de Material · {project.get('project_code','') or ''} · {project.get('name','')}"

    # ====== Auto-generate requisition PDF and attach it ======
    requisition_id = secrets.token_urlsafe(8)
    try:
        req_pdf_bytes = await asyncio.to_thread(
            build_requisition_pdf,
            project,
            signature_name,
            notes,
            requisition_id,
            current_user.get("name", ""),
        )
        # Store PDF in Emergent object storage
        pdf_path = f"{APP_NAME}/requisitions/{current_user['_id']}/{requisition_id}.pdf"
        try:
            await storage_put(pdf_path, req_pdf_bytes, "application/pdf")
        except Exception as e:
            logger.warning(f"storage put requisition pdf failed: {e}")
            pdf_path = None
        attachments.insert(0, {
            "filename": f"requisicao_{project.get('project_code','') or requisition_id}.pdf",
            "content": list(req_pdf_bytes),
        })
    except Exception as e:
        logger.error(f"failed to build requisition PDF: {e}")
        pdf_path = None

    # ====== Save history entry to project.material_requisitions ======
    history_entry = {
        "id": requisition_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
        "created_by_email": current_user.get("email", ""),
        "signature_name": signature_name,
        "notes": notes,
        "recipients": recipients,
        "pdf_path": pdf_path,
        "attachment_count": len(attachments),
        "email_status": "pending",  # updated below
        "email_id": None,
        "materials_snapshot": [
            {
                "item": m.get("item", ""),
                "unit": m.get("unit", "un"),
                "qty_requested": m.get("qty_requested", m.get("quantity", 0)),
                "qty_separated": m.get("qty_separated", 0),
                "qty_written_off": m.get("qty_written_off", 0),
                "qty_delivered": m.get("qty_delivered", 0),
            }
            for m in materials
        ],
        "receipt": None,  # filled by confirm-receipt endpoint
    }

    # ====== Send via Resend ======
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[MATERIAL EMAIL SKIPPED - No RESEND_API_KEY] To={recipients}")
        history_entry["email_status"] = "skipped_no_key"
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"material_requisitions": history_entry}}
        )
        return {"status": "skipped", "reason": "no_api_key", "attachments_count": len(attachments), "requisition_id": requisition_id}

    try:
        import resend
        resend.api_key = api_key
        sender = os.environ.get("SENDER_EMAIL", "Hayah Energy <onboarding@resend.dev>")
        params = {
            "from": sender,
            "to": recipients,
            "subject": subject,
            "html": html,
        }
        if attachments:
            params["attachments"] = attachments
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"Material request email sent to {recipients}: id={result.get('id')}")
        history_entry["email_status"] = "sent"
        history_entry["email_id"] = result.get("id")
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"material_requisitions": history_entry}}
        )
        return {"status": "sent", "id": result.get("id"), "attachments_count": len(attachments), "requisition_id": requisition_id}
    except Exception as e:
        logger.error(f"Failed to send material request: {e}")
        history_entry["email_status"] = "error"
        history_entry["email_error"] = str(e)
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"material_requisitions": history_entry}}
        )
        return {"status": "error", "error": str(e), "requisition_id": requisition_id}


# ====== Material requisition detail endpoints ======

@api_router.get("/projects/{project_id}/requisitions/{req_id}/pdf")
async def download_requisition_pdf(
    project_id: str,
    req_id: str,
    current_user: dict = Depends(get_current_user),
):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    reqs = project.get("material_requisitions", []) or []
    req = next((r for r in reqs if r.get("id") == req_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Requisição não encontrada")
    if req.get("pdf_path"):
        try:
            data, _ct = await storage_get(req["pdf_path"])
            return Response(
                content=data,
                media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="requisicao_{req_id}.pdf"'},
            )
        except Exception:
            pass
    # Rebuild on the fly if storage missing
    data = await asyncio.to_thread(
        build_requisition_pdf,
        project, req.get("signature_name", ""), req.get("notes", ""),
        req_id, req.get("created_by", ""),
    )
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="requisicao_{req_id}.pdf"'},
    )


@api_router.post("/projects/{project_id}/requisitions/{req_id}/resend")
async def resend_requisition(
    project_id: str,
    req_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Resend the same requisition (same PDF, same recipients) — logs a new history entry linked to the original."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    reqs = project.get("material_requisitions", []) or []
    original = next((r for r in reqs if r.get("id") == req_id), None)
    if not original:
        raise HTTPException(status_code=404, detail="Requisição original não encontrada")

    recipients = original.get("recipients") or []
    if not recipients:
        raise HTTPException(status_code=400, detail="Requisição original sem destinatários")

    # Load or rebuild the PDF
    pdf_bytes = None
    if original.get("pdf_path"):
        try:
            pdf_bytes, _ = await storage_get(original["pdf_path"])
        except Exception:
            pdf_bytes = None
    if not pdf_bytes:
        pdf_bytes = await asyncio.to_thread(
            build_requisition_pdf,
            project, original.get("signature_name", ""), original.get("notes", ""),
            req_id, original.get("created_by", ""),
        )

    # Build a lightweight resend email HTML (references original snapshot)
    snap = original.get("materials_snapshot", []) or []
    rows_html = ""
    for m in snap:
        rows_html += f"""
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">{m.get('item','')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">{m.get('unit','un')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">{m.get('qty_requested', 0):g}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#00A050;">{m.get('qty_separated', 0):g}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#E55400;">{m.get('qty_written_off', 0):g}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#005EE0;font-weight:bold;">{m.get('qty_delivered', 0):g}</td>
        </tr>"""
    original_date_iso = (original.get("created_at") or "")[:16].replace("T", " ")
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px;">
      <div style="background:#FF5E00;color:#050505;padding:10px 16px;font-weight:bold;">🔁 REENVIO da requisição de {original_date_iso}</div>
      <h1 style="color: #E0FF00; background: #050505; padding: 16px; margin: 0;">HAYAH ENERGY</h1>
      <div style="background: #050505; color: #fff; padding: 24px;">
        <h2 style="color: #00F0FF; margin-top: 0;">Solicitação de Material (Reenvio)</h2>
        <table width="100%" style="border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #a1a1aa; width: 40%;">Projeto:</td><td style="color: #fff; font-weight: bold;">{project.get('name','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Nº Obra:</td><td style="color: #fff;">{project.get('project_code','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Localidade:</td><td style="color: #fff;">{project.get('location','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Equipe:</td><td style="color: #fff;">{project.get('team_name','') or '-'}{(' + ' + (project.get('additional_team_name') or '')) if project.get('additional_team_name') else ''}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Solicitado por:</td><td style="color: #fff;">{original.get('created_by','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Assinado por:</td><td style="color: #fff;">{original.get('signature_name','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Reenviado por:</td><td style="color: #fff;">{current_user.get('name','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Reenviado em:</td><td style="color: #fff;">{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')}</td></tr>
        </table>
        <h3 style="color:#00F0FF;margin-top:24px;margin-bottom:8px;">Lista original ({len(snap)} itens)</h3>
        <table width="100%" style="border-collapse:collapse;background:#fff;color:#050505;font-size:12px;border:1px solid #ddd;">
          <thead><tr style="background:#050505;color:#E0FF00;">
            <th style="padding:6px 8px;text-align:left;">Item</th>
            <th style="padding:6px 8px;">Un</th>
            <th style="padding:6px 8px;text-align:right;">Solicitado</th>
            <th style="padding:6px 8px;text-align:right;">Separado</th>
            <th style="padding:6px 8px;text-align:right;">Baixado</th>
            <th style="padding:6px 8px;text-align:right;">Entregue</th>
          </tr></thead>
          <tbody>{rows_html}</tbody>
        </table>
        <p style="color:#71717a;font-size:11px;margin-top:24px;">PDF original em anexo. Requisição nº <b>{req_id}</b>.</p>
      </div>
    </div>
    """
    subject = f"[HAYAH · REENVIO] Solicitação de Material · {project.get('project_code','') or ''} · {project.get('name','')}"

    attachments = [{
        "filename": f"requisicao_{project.get('project_code','') or req_id}.pdf",
        "content": list(pdf_bytes),
    }]

    resend_entry = {
        "id": secrets.token_urlsafe(8),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
        "created_by_email": current_user.get("email", ""),
        "signature_name": original.get("signature_name", ""),
        "notes": f"(Reenvio da requisição {req_id})",
        "recipients": recipients,
        "pdf_path": original.get("pdf_path"),
        "attachment_count": 1,
        "email_status": "pending",
        "email_id": None,
        "materials_snapshot": snap,
        "receipt": None,
        "is_resend": True,
        "original_req_id": req_id,
    }

    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        resend_entry["email_status"] = "skipped_no_key"
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"material_requisitions": resend_entry}}
        )
        return {"status": "skipped", "reason": "no_api_key", "resend_id": resend_entry["id"]}

    try:
        import resend
        resend.api_key = api_key
        sender = os.environ.get("SENDER_EMAIL", "Hayah Energy <onboarding@resend.dev>")
        result = await asyncio.to_thread(resend.Emails.send, {
            "from": sender, "to": recipients, "subject": subject, "html": html,
            "attachments": attachments,
        })
        logger.info(f"Requisition RESEND to {recipients}: id={result.get('id')}")
        resend_entry["email_status"] = "sent"
        resend_entry["email_id"] = result.get("id")
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"material_requisitions": resend_entry}}
        )
        return {"status": "sent", "id": result.get("id"), "resend_id": resend_entry["id"]}
    except Exception as e:
        logger.error(f"Resend failed: {e}")
        resend_entry["email_status"] = "error"
        resend_entry["email_error"] = str(e)
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$push": {"material_requisitions": resend_entry}}
        )
        return {"status": "error", "error": str(e), "resend_id": resend_entry["id"]}


@api_router.post("/projects/{project_id}/requisitions/{req_id}/confirm-receipt")
async def confirm_requisition_receipt(
    project_id: str,
    req_id: str,
    receiver_name: str = Form(""),
    notes: str = Form(""),
    photo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    """Mark material as received on site. Optionally attach photo of the delivery ticket."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")

    photo_path = None
    photo_url = None
    if photo:
        content = await photo.read()
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Foto maior que 15MB")
        ext = (photo.filename.rsplit(".", 1)[-1] if photo.filename and "." in photo.filename else "jpg").lower()
        photo_path = f"{APP_NAME}/receipts/{current_user['_id']}/{req_id}-{uuid.uuid4()}.{ext}"
        try:
            result = await storage_put(photo_path, content, photo.content_type or "image/jpeg")
            photo_url = result.get("path")
        except Exception as e:
            logger.warning(f"receipt photo storage failed: {e}")
            photo_path = None

    receipt = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "received_by": receiver_name or current_user.get("name", ""),
        "confirmed_by_email": current_user.get("email", ""),
        "notes": notes,
        "photo_path": photo_path,
        "photo_url": photo_url,
    }

    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "material_requisitions.id": req_id},
        {"$set": {"material_requisitions.$.receipt": receipt}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Requisição não encontrada")
    return {"status": "confirmed", "receipt": receipt}


@api_router.get("/projects/{project_id}/requisitions/{req_id}/receipt-photo")
async def download_receipt_photo(
    project_id: str,
    req_id: str,
    current_user: dict = Depends(get_current_user),
):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    reqs = project.get("material_requisitions", []) or []
    req = next((r for r in reqs if r.get("id") == req_id), None)
    if not req or not req.get("receipt") or not req["receipt"].get("photo_path"):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    data, ct = await storage_get(req["receipt"]["photo_path"])
    return Response(content=data, media_type=ct or "image/jpeg")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get('FRONTEND_URL', 'http://localhost:3000')],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_db():
    await db.users.create_index("email", unique=True)
    await db.teams.create_index("user_id")
    await db.projects.create_index("user_id")
    # Object storage init
    await init_storage()
    # TTL index for live tracking positions — auto-expire after 10 minutes
    try:
        await db.tracking_positions.create_index("updated_at", expireAfterSeconds=600)
    except Exception as e:
        logger.warning(f"tracking TTL index: {e}")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        hashed = hash_password(admin_password)
        await db.users.insert_one({
            "email": admin_email, "password_hash": hashed, "name": "Admin",
            "role": "admin", "status": "approved", "permissions": ALL_PERMISSIONS,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Admin user created: {admin_email}")
    else:
        # Ensure admin has full perms + approved
        updates = {}
        if existing.get("status") != "approved": updates["status"] = "approved"
        if not existing.get("permissions"): updates["permissions"] = ALL_PERMISSIONS
        if not verify_password(admin_password, existing["password_hash"]):
            updates["password_hash"] = hash_password(admin_password)
        if updates:
            await db.users.update_one({"email": admin_email}, {"$set": updates})
            logger.info("Admin ensured approved + full permissions")

    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        scheduler = AsyncIOScheduler(timezone="America/Cuiaba")
        scheduler.add_job(daily_scheduled_email_job, CronTrigger(hour=18, minute=0), id="daily_18h_email", replace_existing=True)
        scheduler.add_job(morning_shutdown_check_job, CronTrigger(hour=8, minute=30), id="morning_shutdown_check", replace_existing=True)
        scheduler.add_job(anexo_iv_reminder_job, CronTrigger(hour=9, minute=0), id="anexo_iv_d2_reminder", replace_existing=True)
        scheduler.start()
        logger.info("Scheduler started: 08:30 shutdown + 09:00 anexo-IV D-2 + 18:00 tomorrow email (America/Cuiaba)")
    except Exception as e:
        logger.warning(f"Failed to start scheduler: {e}")

    Path("/app/memory").mkdir(exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write("# Test Credentials\n\n")
        f.write("## Admin Account\n")
        f.write(f"- Email: {admin_email}\n")
        f.write(f"- Password: {admin_password}\n")
        f.write("- Role: admin\n\n")
        f.write("## Auth Endpoints\n")
        f.write("- POST /api/auth/register\n")
        f.write("- POST /api/auth/login\n")
        f.write("- POST /api/auth/logout\n")
        f.write("- GET /api/auth/me\n")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()