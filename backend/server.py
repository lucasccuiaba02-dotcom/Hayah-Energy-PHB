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
import json
import re
import logging
import bcrypt
import jwt
import secrets
import asyncio
import base64
import uuid
import io
import httpx
from PIL import Image, ImageDraw, ImageFont
from zoneinfo import ZoneInfo

from push_notifications import ensure_vapid_keys, broadcast_push
from notifications import (resend_credentials as _resend_credentials, notification_emails as _notification_emails,
                           warehouse_emails as _warehouse_emails, stock_instant_alert as _stock_instant_alert,
                           notifications_tick as _notifications_tick, build_router as _build_notifications_router)
import campo as _campo
from daily_log_pdf import build_daily_log_pdf
import pdf_jobs as _pdf_jobs
from avanco_fisico import _shrink_photo
from route_pdf import build_route_pdf
from material_requisition_pdf import build_requisition_pdf
from material_ledger import build_material_ledger, build_material_ledger_pdf, build_material_ledger_xlsx, build_consolidated_xlsx

# Module-level cache for geocoding (TTL 60s handled per request)
_geocode_cache: dict = {}

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}

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

def create_access_token(user_id: str, email: str, sv: int = 0) -> str:
    payload = {"sub": user_id, "email": email, "sv": sv, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str, sv: int = 0) -> str:
    payload = {"sub": user_id, "sv": sv, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        token = request.query_params.get("auth") or None  # Set/2026 · links diretos de download (celular / DWG)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Session revocation check: bump session_version to invalidate all outstanding tokens
        current_sv = int(user.get("session_version", 0) or 0)
        token_sv = int(payload.get("sv", 0) or 0)
        if token_sv < current_sv:
            raise HTTPException(status_code=401, detail="Sessão revogada — faça login novamente")
        actor_id = str(user["_id"])
        # Fev/2026 fix: Admins ALWAYS own their own workspace. Never remap _id via owner_id
        # for admins — this prevented admins with pre-existing data from seeing their own
        # projects/teams when accidentally assigned owner_id by a re-approval flow.
        # Also self-heal: if this admin has pre-existing data of their own but somehow
        # ended up with owner_id set, clear it silently.
        role = user.get("role", "user")
        if role == "admin":
            if user.get("owner_id"):
                # Self-heal in prod: admins never share ownership. Detected legacy corruption.
                await db.users.update_one({"_id": user["_id"]}, {"$set": {"owner_id": None}})
                user["owner_id"] = None
            owner_id_str = actor_id
        else:
            # Regular users read/write against the approving admin's data namespace.
            # But if a regular user has their OWN projects (from before demotion/inheritance),
            # let them keep seeing them — restore ownership.
            declared_owner = user.get("owner_id")
            if declared_owner:
                own_count = await db.projects.count_documents({"user_id": actor_id})
                if own_count > 0:
                    # Legacy data corruption: this user has own data but was reassigned to
                    # another admin's workspace. Promote them back to admin of their own data.
                    logger.warning(f"Auto-healing user {user.get('email')} with {own_count} own projects — clearing owner_id and promoting to admin")
                    await db.users.update_one(
                        {"_id": user["_id"]},
                        {"$set": {"owner_id": None, "role": "admin", "permissions": ALL_PERMISSIONS}},
                    )
                    user["owner_id"] = None
                    user["role"] = "admin"
                    user["permissions"] = ALL_PERMISSIONS
                    owner_id_str = actor_id
                else:
                    owner_id_str = str(declared_owner)
            else:
                owner_id_str = actor_id
        user["_id"] = owner_id_str
        user["actor_id"] = actor_id
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
    is_encarregado: bool = False
    team_ids: List[str] = Field(default_factory=list)

# Available page permissions
ALL_PERMISSIONS = [
    "dashboard", "carteira", "programacao", "calendario",
    "operacional", "geolocalizacao", "materiais", "analise",
    "relatorios", "equipes", "estoque", "faturamento", "documentos", "settings", "admin", "avanco", "orcamentos", "campo", "medicao",
]

class TeamCreate(BaseModel):
    name: str
    members: List[str] = Field(default_factory=list)
    supervisor: str = ""
    member_count: int = 0
    daily_target: float = 4000.0  # Meta diária por equipe (R$/dia) — Fev/2026
    tipo: str = "linha_morta"  # linha_morta | linha_viva | mista (Set/2026)

class TeamResponse(BaseModel):
    id: str
    name: str
    members: List[str]
    supervisor: str = ""
    member_count: int = 0
    daily_target: float = 4000.0
    tipo: str = "linha_morta"
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
    estruturas_primarias: int = 0
    estruturas_secundarias: int = 0
    religadores_qty: int = 0
    reguladores_qty: int = 0
    ligacoes_novas: int = 0
    religacoes: int = 0
    desligamentos: int = 0
    # Fev/2026 — datas com desligamento (subconjunto de schedule_entries dates)
    shutdown_dates: Optional[List[str]] = None
    # Set/2026 — datas com serviço em linha viva (subconjunto de schedule_entries dates)
    hot_line_dates: Optional[List[str]] = None
    # Fev/2026 — split de produção por equipe: [{team_id, team_name, programmed_value, actual_value}]
    team_splits: Optional[List[dict]] = None

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
    estruturas_primarias: Optional[int] = None
    estruturas_secundarias: Optional[int] = None
    religadores_qty: Optional[int] = None
    reguladores_qty: Optional[int] = None
    ligacoes_novas: Optional[int] = None
    religacoes: Optional[int] = None
    desligamentos: Optional[int] = None
    shutdown_dates: Optional[List[str]] = None
    hot_line_dates: Optional[List[str]] = None
    team_splits: Optional[List[dict]] = None

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
    material_returns: List[dict] = Field(default_factory=list)
    billing_stage: str = ""
    billing_history: List[dict] = Field(default_factory=list)
    invoice_number: str = ""
    invoice_date: str = ""
    invoice_value: float = 0.0
    postes_qty: int = 0
    transformadores_qty: int = 0
    km_rede: float = 0.0
    estruturas_primarias: int = 0
    estruturas_secundarias: int = 0
    religadores_qty: int = 0
    reguladores_qty: int = 0
    ligacoes_novas: int = 0
    religacoes: int = 0
    desligamentos: int = 0
    shutdown_dates: List[str] = Field(default_factory=list)
    hot_line_dates: List[str] = Field(default_factory=list)
    team_splits: List[dict] = Field(default_factory=list)
    movement_history: List[dict] = Field(default_factory=list)
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
    sv = int(user.get("session_version", 0) or 0)
    access_token = create_access_token(user_id, email, sv)
    refresh_token = create_refresh_token(user_id, sv)

    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")

    return UserResponse(
        id=user_id,
        email=user["email"],
        name=user["name"],
        role=user["role"],
        status=user.get("status", "approved"),
        permissions=user.get("permissions") if user.get("permissions") is not None else (ALL_PERMISSIONS if user.get("role") == "admin" else []),
        created_at=user["created_at"].isoformat(),
        access_token=access_token,
        is_encarregado=bool(user.get("is_encarregado")),
        team_ids=[str(t) for t in (user.get("team_ids") or [])],
    )

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")
    return {"message": "Logged out successfully"}


# ============ Session revocation + password change (Fev/2026) ============

class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class AdminResetPasswordBody(BaseModel):
    new_password: str


@api_router.post("/auth/change-password")
async def change_password_endpoint(
    body: ChangePasswordBody,
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Change own password. Revokes all other sessions and re-issues a token for the current device."""
    user = await db.users.find_one({"_id": ObjectId(current_user["_id"])})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Senha nova precisa ter pelo menos 8 caracteres")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="Nova senha deve ser diferente da atual")
    new_sv = int(user.get("session_version", 0) or 0) + 1
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "password_hash": hash_password(body.new_password),
            "session_version": new_sv,
            "password_changed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    new_access = create_access_token(str(user["_id"]), user["email"], new_sv)
    new_refresh = create_refresh_token(str(user["_id"]), new_sv)
    response.set_cookie(key="access_token", value=new_access, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    response.set_cookie(key="refresh_token", value=new_refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    return {"status": "changed", "access_token": new_access, "session_version": new_sv}


@api_router.post("/auth/logout-all-devices")
async def logout_all_devices_endpoint(
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Revoke sessions on ALL devices (bumps session_version) and reissue a token for the current device."""
    user = await db.users.find_one({"_id": ObjectId(current_user["_id"])})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    new_sv = int(user.get("session_version", 0) or 0) + 1
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"session_version": new_sv}})
    new_access = create_access_token(str(user["_id"]), user["email"], new_sv)
    new_refresh = create_refresh_token(str(user["_id"]), new_sv)
    response.set_cookie(key="access_token", value=new_access, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    response.set_cookie(key="refresh_token", value=new_refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    return {"status": "revoked", "session_version": new_sv, "access_token": new_access}


@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["_id"],
        email=current_user["email"],
        name=current_user["name"],
        role=current_user["role"],
        status=current_user.get("status", "approved"),
        permissions=current_user.get("permissions") if current_user.get("permissions") else ALL_PERMISSIONS,
        created_at=current_user["created_at"].isoformat(),
        is_encarregado=bool(current_user.get("is_encarregado")),
        team_ids=[str(t) for t in (current_user.get("team_ids") or [])],
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
        "is_encarregado": bool(u.get("is_encarregado")),
        "team_ids": [str(t) for t in (u.get("team_ids") or [])],
        "created_at": u["created_at"].isoformat() if hasattr(u["created_at"], "isoformat") else u["created_at"],
    } for u in users]

class UserApprovalBody(BaseModel):
    permissions: List[str] = Field(default_factory=list)
    role: Optional[str] = "user"
    is_encarregado: Optional[bool] = None
    team_ids: Optional[List[str]] = None

@api_router.post("/admin/users/{user_id}/approve")
async def admin_approve_user(user_id: str, body: UserApprovalBody, current_user: dict = Depends(require_admin)):
    perms = [p for p in body.permissions if p in ALL_PERMISSIONS]
    approved_role = body.role or "user"
    # Data namespace: a regular user inherits the approving admin's workspace so they see
    # the same projects/teams/estoque/etc. An admin owns their own workspace by default.
    admin_actor_id = current_user.get("actor_id") or current_user["_id"]
    # Fev/2026 safety: if the user being approved ALREADY has their own data (projects
    # created previously), promote to admin instead of overwriting their workspace.
    own_projects = await db.projects.count_documents({"user_id": user_id})
    if own_projects > 0 and approved_role != "admin":
        logger.warning(f"admin_approve_user: user {user_id} has {own_projects} own projects — auto-promoting to admin to preserve their workspace")
        approved_role = "admin"
    set_doc = {
        "status": "approved",
        "permissions": perms,
        "role": approved_role,
    }
    if body.is_encarregado is not None:
        set_doc["is_encarregado"] = bool(body.is_encarregado)
    if body.team_ids is not None:
        set_doc["team_ids"] = [str(t) for t in body.team_ids]
    if approved_role == "admin":
        # Grant admin ownership of THEIR OWN workspace (independent data namespace).
        set_doc["owner_id"] = None
    else:
        # Regular users read/write against the approving admin's data.
        set_doc["owner_id"] = admin_actor_id
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": set_doc})
    return {"status": "approved", "permissions": perms, "owner_id": set_doc.get("owner_id"), "role": approved_role, "own_projects_preserved": own_projects}

@api_router.post("/admin/users/{user_id}/reject")
async def admin_reject_user(user_id: str, current_user: dict = Depends(require_admin)):
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "rejected"}})
    return {"status": "rejected"}

@api_router.put("/admin/users/{user_id}/permissions")
async def admin_update_permissions(user_id: str, body: UserApprovalBody, current_user: dict = Depends(require_admin)):
    perms = [p for p in body.permissions if p in ALL_PERMISSIONS]
    update = {"permissions": perms}
    if body.is_encarregado is not None:
        update["is_encarregado"] = bool(body.is_encarregado)
    if body.team_ids is not None:
        update["team_ids"] = [str(t) for t in body.team_ids]
    if body.role:
        update["role"] = body.role
        # If admin promotes/demotes, adjust workspace ownership accordingly
        admin_actor_id = current_user.get("actor_id") or current_user["_id"]
        # Fev/2026 safety: if demoting a user who already has own data, refuse to remap
        # their workspace ownership — force admin role instead so their data stays accessible.
        if body.role != "admin":
            own_projects = await db.projects.count_documents({"user_id": user_id})
            if own_projects > 0:
                logger.warning(f"admin_update_permissions: user {user_id} has {own_projects} own projects — keeping as admin to preserve workspace")
                update["role"] = "admin"
                update["owner_id"] = None
            else:
                update["owner_id"] = admin_actor_id  # shares admin's workspace
        else:
            update["owner_id"] = None  # gains own workspace
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update})
    return {"status": "updated", "permissions": perms, "role": update.get("role")}


@api_router.post("/auth/repair-my-workspace")
async def repair_my_workspace(request: Request):
    """Fev/2026 recovery endpoint — if the authenticated user has their own data
    (projects/teams with user_id = their own _id) but was reassigned to another
    workspace via owner_id, clear owner_id and promote them to admin.
    Also revokes existing sessions so they must re-login (fresh token with role=admin).
    Safe to call multiple times — no-op if there's nothing to fix."""
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        user_id_str = payload["sub"]
        user = await db.users.find_one({"_id": ObjectId(user_id_str)})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    own_projects = await db.projects.count_documents({"user_id": user_id_str})
    own_teams = await db.teams.count_documents({"user_id": user_id_str})
    old_owner = user.get("owner_id")
    old_role = user.get("role", "user")

    # Only heal if user has own data and something is misconfigured
    if own_projects == 0 and own_teams == 0:
        return {
            "status": "no_data_to_recover",
            "own_projects": 0,
            "own_teams": 0,
            "role": old_role,
            "owner_id": old_owner,
            "message": "Sua conta não tem obras/equipes cadastradas com seu ID de usuário. Nada para recuperar automaticamente — contate o suporte se você acredita que existem dados."
        }

    needs_fix = bool(old_owner) or old_role != "admin"
    if not needs_fix:
        return {
            "status": "already_healthy",
            "own_projects": own_projects,
            "own_teams": own_teams,
            "role": old_role,
        }

    new_sv = int(user.get("session_version", 0) or 0) + 1
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "owner_id": None,
            "role": "admin",
            "permissions": ALL_PERMISSIONS,
            "session_version": new_sv,
        }},
    )
    logger.warning(f"repair_my_workspace: healed user {user.get('email')} — restored {own_projects} projects + {own_teams} teams, promoted to admin, revoked sessions")
    return {
        "status": "repaired",
        "own_projects": own_projects,
        "own_teams": own_teams,
        "previous_owner_id": old_owner,
        "previous_role": old_role,
        "new_role": "admin",
        "message": f"Recuperados: {own_projects} obras e {own_teams} equipes. Faça login novamente para ver seus dados.",
        "must_relogin": True,
    }

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, current_user: dict = Depends(require_admin)):
    actor_id = current_user.get("actor_id") or current_user["_id"]
    if str(actor_id) == user_id:
        raise HTTPException(status_code=400, detail="Não é possível remover o próprio usuário")
    await db.users.delete_one({"_id": ObjectId(user_id)})
    return {"status": "deleted"}


@api_router.post("/admin/users/{user_id}/force-logout")
async def admin_force_logout(user_id: str, current_user: dict = Depends(require_admin)):
    """Admin bumps session_version of another user, invalidating all their tokens."""
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    new_sv = int(user.get("session_version", 0) or 0) + 1
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"session_version": new_sv}})
    return {"status": "forced_logout", "session_version": new_sv, "user_id": user_id}


@api_router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, body: AdminResetPasswordBody, current_user: dict = Depends(require_admin)):
    """Admin sets a temporary password for another user AND revokes their sessions."""
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Senha precisa ter pelo menos 8 caracteres")
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    new_sv = int(user.get("session_version", 0) or 0) + 1
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "password_hash": hash_password(body.new_password),
            "session_version": new_sv,
            "password_changed_at": datetime.now(timezone.utc).isoformat(),
            "password_reset_by_admin": current_user.get("email", ""),
        }},
    )
    return {"status": "reset", "session_version": new_sv, "user_id": user_id}


# ============ Meta Contratual (Fev/2026) — configurável com histórico ============
class ContractTargetBody(BaseModel):
    target: float
    month: str = "default"  # "YYYY-MM" ou "default" (global)
    note: str = ""


@api_router.get("/admin/contract-target")
async def admin_get_contract_target(current_user: dict = Depends(require_admin)):
    """Retorna configuração vigente + histórico completo por mês."""
    from datetime import datetime as _dt, timezone as _tz
    now = _dt.now(_tz.utc)
    cur_ym = now.strftime("%Y-%m")

    all_docs = await db.contract_targets.find({"user_id": current_user["_id"]}).sort("updated_at", -1).to_list(200)

    def _fmt(d):
        return {
            "id": str(d["_id"]),
            "month": d.get("month", "default"),
            "target": float(d.get("target") or 0),
            "note": d.get("note", ""),
            "updated_by": d.get("updated_by", ""),
            "updated_at": d.get("updated_at").isoformat() if hasattr(d.get("updated_at"), "isoformat") else str(d.get("updated_at", "")),
        }

    history = [_fmt(d) for d in all_docs]

    # Vigente: mês atual > default > 336000
    cur_doc = next((d for d in all_docs if d.get("month") == cur_ym), None)
    default_doc = next((d for d in all_docs if d.get("month") == "default"), None)
    active_target = float((cur_doc or default_doc or {}).get("target") or 336000.0)
    active_source = "month" if cur_doc else ("default" if default_doc else "system_default")

    return {
        "active_target": active_target,
        "active_source": active_source,
        "current_month": cur_ym,
        "system_default": 336000.0,
        "history": history,
    }


@api_router.post("/admin/contract-target")
async def admin_set_contract_target(body: ContractTargetBody, current_user: dict = Depends(require_admin)):
    """Cria/atualiza a meta contratual do mês (ou default global)."""
    if body.target <= 0:
        raise HTTPException(status_code=400, detail="Meta deve ser maior que zero")
    month_key = (body.month or "default").strip()
    # valida formato "YYYY-MM" ou "default"
    if month_key != "default":
        try:
            _dt_ = datetime.strptime(month_key, "%Y-%m")
        except Exception:
            raise HTTPException(status_code=400, detail="Formato inválido — use YYYY-MM ou 'default'")
    doc = {
        "user_id": current_user["_id"],
        "month": month_key,
        "target": float(body.target),
        "note": body.note or "",
        "updated_by": current_user.get("email", ""),
        "updated_at": datetime.now(timezone.utc),
    }
    # upsert por (user_id, month) para manter apenas 1 registro por mês (idempotente)
    await db.contract_targets.update_one(
        {"user_id": current_user["_id"], "month": month_key},
        {"$set": doc},
        upsert=True,
    )
    return {"status": "ok", "month": month_key, "target": float(body.target)}


@api_router.delete("/admin/contract-target/{item_id}")
async def admin_delete_contract_target(item_id: str, current_user: dict = Depends(require_admin)):
    """Remove um registro de meta contratual (permite reverter)."""
    await db.contract_targets.delete_one({"_id": safe_object_id(item_id), "user_id": current_user["_id"]})
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

# ============ Team Unproductivity (Improdutividade) — Fev/2026 ============
class TeamUnproductivityBody(BaseModel):
    team_id: str
    date: str  # YYYY-MM-DD
    reason: str = "outro"  # chuva, falta_material, falta_equipe, quebra_equipamento, espera_desligamento, acesso_bloqueado, acidente, retrabalho, outro
    hours_lost: float = 0.0
    notes: str = ""

@api_router.get("/team-unproductivity")
async def list_team_unproductivity(current_user: dict = Depends(get_current_user), start: str = "", end: str = ""):
    q = {"user_id": current_user["_id"]}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        q["date"] = rng
    docs = await db.team_unproductivity.find(q).sort("date", -1).to_list(2000)
    return [{
        "id": str(d["_id"]),
        "team_id": d["team_id"],
        "team_name": d.get("team_name", ""),
        "date": d["date"],
        "reason": d.get("reason", "outro"),
        "hours_lost": d.get("hours_lost", 0.0),
        "notes": d.get("notes", ""),
    } for d in docs]

@api_router.post("/team-unproductivity")
async def create_team_unproductivity(body: TeamUnproductivityBody, current_user: dict = Depends(get_current_user)):
    team = await db.teams.find_one({"_id": safe_object_id(body.team_id), "user_id": current_user["_id"]})
    if not team: raise HTTPException(status_code=404, detail="Equipe não encontrada")
    doc = {
        "user_id": current_user["_id"],
        "team_id": body.team_id,
        "team_name": team.get("name", ""),
        "date": body.date,
        "reason": body.reason,
        "hours_lost": float(body.hours_lost or 0),
        "notes": body.notes,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.team_unproductivity.insert_one(doc)
    return {"status": "ok", "id": str(res.inserted_id)}

@api_router.delete("/team-unproductivity/{item_id}")
async def delete_team_unproductivity(item_id: str, current_user: dict = Depends(get_current_user)):
    await db.team_unproductivity.delete_one({"_id": safe_object_id(item_id), "user_id": current_user["_id"]})
    return {"status": "deleted"}

# ============ Material Requisition Response (Almoxarifado retorna status) — Fev/2026 ============
WAREHOUSE_RESPONSE_STATUSES = {
    "separado", "baixado", "separado_parcial", "na_doca",
    "faltam_materiais", "devolvido", "aguardando_fornecedor", "outro",
}

class WarehouseResponseBody(BaseModel):
    status: str
    responsible: str = ""
    notes: str = ""
    missing_items: str = ""  # usado quando status = faltam_materiais

@api_router.post("/projects/{project_id}/materials/{req_id}/response")
async def set_warehouse_response(project_id: str, req_id: str, body: WarehouseResponseBody, current_user: dict = Depends(get_current_user)):
    if body.status not in WAREHOUSE_RESPONSE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status inválido. Aceitos: {sorted(WAREHOUSE_RESPONSE_STATUSES)}")
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project: raise HTTPException(status_code=404, detail="Obra não encontrada")
    reqs = project.get("material_requisitions", []) or []
    if not any(r.get("id") == req_id for r in reqs):
        raise HTTPException(status_code=404, detail="Requisição não encontrada")
    response = {
        "status": body.status,
        "responsible": body.responsible,
        "notes": body.notes,
        "missing_items": body.missing_items,
        "answered_at": datetime.now(timezone.utc).isoformat(),
        "answered_by": current_user.get("email", ""),
    }
    await db.projects.update_one(
        {"_id": safe_object_id(project_id), "material_requisitions.id": req_id},
        {"$set": {"material_requisitions.$.warehouse_response": response}}
    )
    return {"status": "ok", "warehouse_response": response}

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
async def pending_returns(current_user: dict = Depends(get_current_user), date: str = "", mode: str = ""):
    """Retorna projetos programados que ainda não têm retorno registrado.
    - mode='all' (default se date vazio): TODAS as obras programadas em dias <= hoje sem retorno,
      ordenadas por data (mais antigo primeiro) — cada linha (project, target_date).
    - date='YYYY-MM-DD': só as programadas naquela data específica sem retorno."""
    from datetime import timedelta as td
    today_s = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Buscar todas obras programadas (para expandir schedule_entries)
    all_scheduled = await db.projects.find({
        "user_id": current_user["_id"],
        "is_scheduled": True,
        "execution_status": {"$nin": ["concluido", "cancelado", "suspenso"]},
    }).to_list(2000)

    result: list = []
    for p in all_scheduled:
        # Enumerar datas programadas: schedule_entries[].date se houver, senão start_date
        entries = p.get("schedule_entries") or []
        dates: list = []
        if entries:
            for e in entries:
                d = (e.get("date") or "")[:10]
                if d: dates.append(d)
        else:
            d = (p.get("start_date") or "")[:10]
            if d: dates.append(d)
        # Datas com retorno já registrado
        returns = p.get("daily_returns", []) or []
        done_dates = {r.get("date") for r in returns if r.get("date")}
        for d in dates:
            # Filtragem por date param OU por modo "all_pending" (default): d <= today
            if date:
                if d != date:
                    continue
            else:
                # modo padrão: obras de dias anteriores/hoje sem retorno
                if d > today_s:
                    continue
            if d in done_dates:
                continue
            item = build_project_response(p).model_dump() | {"target_date": d}
            result.append(item)
    # Ordenar por data ascendente (mais antigo primeiro para forçar preenchimento)
    result.sort(key=lambda x: (x.get("target_date", ""), x.get("project_code", "")))
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
    def status_of(p): return p.get("execution_status") or "aguardando_programacao"
    def prog(p): return float(p.get("programmed_value") or 0)
    def prod(p): return float(p.get("actual_value") or 0)
    INACTIVE_STATUS = ("executada", "concluido", "cancelado", "suspenso")
    in_andamento = [p for p in projects if status_of(p) in ("programado", "em_execucao")]

    # Vencidas: baseadas na DATA VENCIMENTO do cadastro (expiry_date). Sem data → não conta.
    def is_vencivel(p): return bool(p.get("expiry_date")) and status_of(p) not in INACTIVE_STATUS
    vencidas = [p for p in projects if is_vencivel(p) and date_str(p["expiry_date"]) < today]
    no_prazo = [p for p in projects if is_vencivel(p) and date_str(p["expiry_date"]) >= today]
    vencendo_amanha = [p for p in projects if is_vencivel(p) and date_str(p["expiry_date"]) == tomorrow]
    atrasadas = vencidas
    for p in vencidas:
        p["dias_vencida"] = (datetime.fromisoformat(today) - datetime.fromisoformat(date_str(p["expiry_date"]))).days
    vencidas.sort(key=lambda p: date_str(p["expiry_date"]))

    total = len(projects)
    concluidas_all = [p for p in projects if status_of(p) in ("executada", "concluido")]
    perc_conclusao = round(100 * len(concluidas_all) / total, 1) if total else 0

    # ---- Carteira: Apta / Não Apta / Programadas / Concluídas (qtd + valor + %) ----
    CARTEIRA_GROUPS = {
        "apta": ("aguardando_programacao", "a_reprogramar", "em_execucao"),
        "nao_apta": ("cancelado", "suspenso"),
        "programadas": ("programado",),
        "concluidas": ("concluido", "executada"),
    }
    carteira_total_value = sum(prog(p) for p in projects)
    carteira_total_labor = sum(float(p.get("labor_cost") or 0) for p in projects)
    carteira = {}
    for key, statuses in CARTEIRA_GROUPS.items():
        grp = [p for p in projects if status_of(p) in statuses]
        # Carteira Apta: valor = soma da MÃO DE OBRA cadastrada (labor_cost); demais = valor programado
        if key == "apta":
            val = sum(float(p.get("labor_cost") or 0) for p in grp)
            pct_value = round(100 * val / carteira_total_labor, 1) if carteira_total_labor else 0.0
            basis = "labor_cost"
        else:
            val = sum(prog(p) for p in grp)
            pct_value = round(100 * val / carteira_total_value, 1) if carteira_total_value else 0.0
            basis = "programmed_value"
        carteira[key] = {
            "count": len(grp),
            "value": round(val, 2),
            "value_basis": basis,
            "programmed_value": round(sum(prog(p) for p in grp), 2),
            "actual_value": round(sum(prod(p) for p in grp), 2),
            "pct_count": round(100 * len(grp) / total, 1) if total else 0.0,
            "pct_value": pct_value,
            "statuses": list(statuses),
        }
    carteira["total"] = {"count": total, "value": round(carteira_total_value, 2), "labor_value": round(carteira_total_labor, 2)}

    # ---- Financeiro: Faturado (Pago) / Pendente (concluídas não pagas) / Receita do mês ----
    def exec_date(p):
        """Data real de execução: execution_finished_at → último retorno executado → end_date (se concluída)."""
        if p.get("execution_finished_at"):
            return date_str(p["execution_finished_at"])
        done = sorted(r.get("date", "") for r in (p.get("daily_returns") or []) if r.get("executed") and r.get("date"))
        if done:
            return done[-1]
        return date_str(p.get("end_date")) if status_of(p) in ("executada", "concluido") else ""

    def stage_entered(p, stage):
        """1ª data em que a obra entrou no estágio (ou em estágio posterior, se pulou)."""
        idx = BILLING_STAGES.index(stage)
        hist = sorted((h for h in (p.get("billing_history") or []) if h.get("changed_at")), key=lambda h: h["changed_at"])
        for h in hist:
            if h.get("stage") in BILLING_STAGES and BILLING_STAGES.index(h["stage"]) >= idx:
                return date_str(h["changed_at"])
        return ""

    pagas = [p for p in projects if p.get("billing_stage") == "pago"]
    valor_faturado = sum(prod(p) for p in pagas)
    pendentes = [p for p in concluidas_all if p.get("billing_stage") != "pago"]
    valor_pendente = sum(prod(p) for p in pendentes)

    ct_current = await db.contract_targets.find_one({"user_id": current_user["_id"], "month": now.strftime("%Y-%m")})
    ct_global = await db.contract_targets.find_one({"user_id": current_user["_id"], "month": "default"})
    meta_mes = float((ct_current or ct_global or {}).get("target") or 336000.0)
    executadas_mes = [p for p in concluidas_all if exec_date(p) >= month_start]
    concluidas_mes = executadas_mes
    receita_realizada = sum(prod(p) for p in executadas_mes)
    pagas_mes = [p for p in pagas if stage_entered(p, "pago") >= month_start]
    pago_mes = sum(prod(p) for p in pagas_mes)
    receita_prevista_mes = meta_mes
    meta_total = sum(prog(p) for p in projects)
    realizado_total = sum(prod(p) for p in projects)

    postes = sum((p.get("postes_qty") or 0) for p in projects)
    trafos = sum((p.get("transformadores_qty") or 0) for p in projects)
    km_rede = sum((p.get("km_rede") or 0) for p in projects)
    estr_prim = sum((p.get("estruturas_primarias") or 0) for p in projects)
    estr_sec = sum((p.get("estruturas_secundarias") or 0) for p in projects)
    religadores = sum((p.get("religadores_qty") or 0) for p in projects)
    reguladores = sum((p.get("reguladores_qty") or 0) for p in projects)
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
    def first_sched(p):
        dates = sorted(date_str(e.get("date")) for e in (p.get("schedule_entries") or []) if e.get("date"))
        return dates[0] if dates else date_str(p.get("start_date"))
    diff_recebimento_programacao = [days_between(p["received_date"], first_sched(p)) for p in projects if p.get("received_date") and first_sched(p)]
    diff_programacao_execucao = [days_between(first_sched(p), exec_date(p)) for p in projects if first_sched(p) and exec_date(p)]
    diff_execucao_fechamento = [days_between(exec_date(p), stage_entered(p, "em_fechamento")) for p in projects if exec_date(p) and stage_entered(p, "em_fechamento")]
    diff_fechamento_faturamento = [days_between(stage_entered(p, "em_fechamento"), stage_entered(p, "pago")) for p in projects if stage_entered(p, "em_fechamento") and stage_entered(p, "pago")]
    def avg(lst):
        vs = [v for v in lst if v is not None]
        return {"avg": round(sum(vs) / len(vs), 1) if vs else 0, "samples": len(vs)}

    # Serviços concluídos por dia (últimos 14 dias)
    from collections import defaultdict
    by_day = defaultdict(int)
    cutoff = (now - td(days=14)).strftime("%Y-%m-%d")
    for p in concluidas_all:
        d = exec_date(p)
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

    def vencida_item(p):
        item = build_project_response(p).model_dump()
        item["dias_vencida"] = p.get("dias_vencida", 0)
        return item

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
        "carteira": carteira,
        "financeiro": {
            "perc_conclusao": perc_conclusao,
            "valor_faturado": round(valor_faturado, 2),
            "faturado_count": len(pagas),
            "valor_pendente_faturamento": round(valor_pendente, 2),
            "pendente_count": len(pendentes),
            "receita_prevista_mes": round(receita_prevista_mes, 2),
            "meta_mes": round(meta_mes, 2),
            "meta_source": "month" if ct_current else ("default" if ct_global else "system_default"),
            "receita_realizada": round(receita_realizada, 2),
            "receita_realizada_count": len(executadas_mes),
            "receita_pct": round(100 * receita_realizada / meta_mes, 1) if meta_mes else 0.0,
            "pago_mes": round(pago_mes, 2),
            "pago_mes_count": len(pagas_mes),
            "meta_total": round(meta_total, 2),
            "realizado_total": round(realizado_total, 2),
        },
        "operacional": {
            "postes": postes,
            "transformadores": trafos,
            "km_rede": round(km_rede, 2),
            "estruturas_primarias": estr_prim,
            "estruturas_secundarias": estr_sec,
            "religadores": religadores,
            "reguladores": reguladores,
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
        "vencidas": [vencida_item(p) for p in vencidas[:50]],
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
        daily_target=float(team.get("daily_target") or 4000.0),
        tipo=team.get("tipo") or "linha_morta",
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
        "daily_target": float(team_data.daily_target or 4000.0),
        "tipo": team_data.tipo if team_data.tipo in ("linha_morta", "linha_viva", "mista") else "linha_morta",
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
        "daily_target": float(team_data.daily_target or 4000.0),
        "tipo": team_data.tipo if team_data.tipo in ("linha_morta", "linha_viva", "mista") else "linha_morta",
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
        material_returns=project.get("material_returns", []) or [],
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
        estruturas_primarias=project.get("estruturas_primarias", 0) or 0,
        estruturas_secundarias=project.get("estruturas_secundarias", 0) or 0,
        religadores_qty=project.get("religadores_qty", 0) or 0,
        reguladores_qty=project.get("reguladores_qty", 0) or 0,
        ligacoes_novas=project.get("ligacoes_novas", 0),
        religacoes=project.get("religacoes", 0),
        desligamentos=project.get("desligamentos", 0),
        shutdown_dates=project.get("shutdown_dates", []) or [],
        hot_line_dates=project.get("hot_line_dates", []) or [],
        team_splits=project.get("team_splits", []) or [],
        movement_history=project.get("movement_history", []) or [],
        created_at=project["created_at"].isoformat() if hasattr(project["created_at"], 'isoformat') else project["created_at"],
    )


def _build_movements(existing: dict, update_data: dict, reschedule_reason: str, notes_text: str, changed_by: str) -> list:
    """Build movement_history entries from a project diff (Fev/2026 — timeline visível na Programação).
    Captura mudanças de data, equipe, status, observações, cancelamento e team_splits."""
    now_iso = datetime.now(timezone.utc).isoformat()
    movements: list = []

    def add(event_type: str, old_val, new_val, extra_note: str = ""):
        entry = {
            "event_type": event_type,
            "changed_at": now_iso,
            "changed_by": changed_by,
            "old": old_val,
            "new": new_val,
            "reason": reschedule_reason or "",
            "notes": (notes_text or extra_note or "").strip(),
        }
        movements.append(entry)

    # 1) Datas / Programações
    old_start = (existing.get("start_date") or "")[:10]
    old_end = (existing.get("end_date") or "")[:10]
    new_start = (update_data.get("start_date") or old_start)[:10] if "start_date" in update_data else old_start
    new_end = (update_data.get("end_date") or old_end)[:10] if "end_date" in update_data else old_end
    if (new_start != old_start) or (new_end != old_end):
        add("date_changed", {"start": old_start, "end": old_end}, {"start": new_start, "end": new_end})

    # 2) Equipes principais/adicionais
    old_team = existing.get("team_name") or ""
    new_team = update_data.get("team_name", old_team) if "team_name" in update_data else old_team
    old_add = existing.get("additional_team_name") or ""
    new_add = update_data.get("additional_team_name", old_add) if "additional_team_name" in update_data else old_add
    if (new_team != old_team) or (new_add != old_add):
        add("team_changed", {"team": old_team, "additional": old_add}, {"team": new_team, "additional": new_add})

    # 3) Status execução
    old_status = existing.get("execution_status") or ""
    new_status = update_data.get("execution_status", old_status)
    if new_status != old_status:
        add("status_changed", old_status, new_status)

    # 4) Observações relevantes
    for f, label in [("shutdown_info", "shutdown"), ("cancel_reason", "cancel_reason")]:
        if f in update_data:
            old_v = (existing.get(f) or "").strip()
            new_v = (update_data.get(f) or "").strip()
            if old_v != new_v:
                add(f, old_v, new_v)

    # 5) Split de equipes (comparação normalizada — não considera ordem)
    if "team_splits" in update_data:
        def _norm(items):
            return sorted(
                [{
                    "team_id": (x or {}).get("team_id", ""),
                    "team_name": (x or {}).get("team_name", ""),
                    "programmed_value": float((x or {}).get("programmed_value") or 0),
                    "actual_value": float((x or {}).get("actual_value") or 0),
                } for x in (items or [])],
                key=lambda r: r["team_id"] or r["team_name"],
            )
        old_ts = _norm(existing.get("team_splits"))
        new_ts = _norm(update_data.get("team_splits"))
        if old_ts != new_ts:
            add("team_splits_changed", existing.get("team_splits") or [], update_data.get("team_splits") or [])

    return movements


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

    # Movement inicial (Fev/2026)
    project_doc["movement_history"] = [{
        "event_type": "created",
        "changed_at": datetime.now(timezone.utc).isoformat(),
        "changed_by": current_user.get("name", ""),
        "old": None,
        "new": {
            "name": project_doc.get("name", ""),
            "project_code": project_doc.get("project_code", ""),
            "team": project_doc.get("team_name", ""),
            "start_date": (project_doc.get("start_date") or "")[:10],
            "end_date": (project_doc.get("end_date") or "")[:10],
            "execution_status": project_doc.get("execution_status", ""),
        },
        "reason": "",
        "notes": "Obra programada" if project_doc.get("is_scheduled") else "Obra cadastrada na carteira",
    }]

    
    result = await db.projects.insert_one(project_doc)
    project_doc["_id"] = result.inserted_id
    
    if project_doc.get("is_scheduled"):
        recipients = await _notification_emails(db)
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
    
    # Auto-set execution_status ao programar uma obra já cadastrada (Set/2026 — espelha o create_project)
    will_be_scheduled = update_data.get("is_scheduled", existing.get("is_scheduled"))
    has_dates = bool(update_data.get("schedule_entries") or update_data.get("start_date") or existing.get("schedule_entries") or existing.get("start_date"))
    status_after = update_data.get("execution_status", existing.get("execution_status"))
    if will_be_scheduled and has_dates and "execution_status" not in update_data and status_after in (None, "", "aguardando_programacao"):
        update_data["execution_status"] = "programado"

    # Build unified movement_history entries (Fev/2026)
    movements = _build_movements(existing, update_data, reschedule_reason, "", current_user.get("name", ""))
    
    mongo_update: dict = {"$set": update_data}
    if movements:
        mongo_update["$push"] = {"movement_history": {"$each": movements}}
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"]},
        mongo_update
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
    "digitada",
    "aprovada",
    "pago",
]

BILLING_STAGE_LABELS = {
    "recebimento_tecnico": "Recebimento Técnico",
    "em_fechamento": "Em Fechamento",
    "ajuste_material": "Ajuste de Material",
    "pendencia_construtiva": "Pendência Construtiva",
    "aguardando_fiscalizacao": "Aguardando Fiscalização",
    "digitada": "Digitada",
    "aprovada": "Aprovada",
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

    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {
        "stage": body.stage,
        "changed_at": now_iso,
        "changed_by": current_user.get("name", ""),
        "notes": body.notes or "",
    }
    # Also append to unified movement_history
    movement_entry = {
        "event_type": "billing_stage_changed",
        "changed_at": now_iso,
        "changed_by": current_user.get("name", ""),
        "old": existing.get("billing_stage", ""),
        "new": body.stage,
        "reason": "",
        "notes": body.notes or "",
    }
    await db.projects.update_one(
        {"_id": safe_object_id(project_id)},
        {"$set": updates, "$push": {"billing_history": entry, "movement_history": movement_entry}},
    )
    project = await db.projects.find_one({"_id": safe_object_id(project_id)})
    return build_project_response(project)


@api_router.get("/faturamento/pipeline")
async def billing_pipeline(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Pipeline (esteira) grouped by billing_stage. Filter by billing_stage-change date (from billing_history).
    Obras canceladas/suspensas não aparecem — são obras inativas."""
    query: dict = {
        "user_id": current_user["_id"],
        "billing_stage": {"$ne": ""},
        "execution_status": {"$nin": ["cancelado", "suspenso"]},
    }
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
        prog_val = float(p.get("programmed_value") or 0)
        actual_val = float(p.get("actual_value") or 0)
        # Faturamento acompanha PRODUÇÃO REALIZADA, não valor programado
        val = actual_val
        inv_val = float(p.get("invoice_value") or 0)
        item = {
            "id": str(p["_id"]),
            "project_code": p.get("project_code", ""),
            "name": p.get("name", ""),
            "team_name": p.get("team_name", ""),
            "location": p.get("location", ""),
            "actual_value": actual_val,
            "programmed_value": prog_val,
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

    # === Lead-time indicators + stuck project detection (Fev/2026) ===
    from datetime import datetime as _dt, timezone as _tz
    today = _dt.now(_tz.utc).date()

    def _iso_to_date(s: str):
        try:
            return _dt.fromisoformat((s or "")[:10]).date()
        except Exception:
            return None

    # For every project, compute days in current stage + walk billing_history to compute per-transition durations
    STUCK_THRESHOLD_DAYS = 15
    transition_days: dict = {}  # key = "from→to" → list of days
    stuck_projects: list = []
    for p in projects:
        stage = p.get("billing_stage") or ""
        if stage not in pipeline:
            continue
        entered_iso = entered_stage_at(p)
        entered_d = _iso_to_date(entered_iso)
        days_in_stage = (today - entered_d).days if entered_d else 0
        # attach days_in_stage to pipeline item
        for it in pipeline.get(stage, []):
            if it["id"] == str(p["_id"]):
                it["days_in_stage"] = max(0, days_in_stage)
                it["is_stuck"] = days_in_stage >= STUCK_THRESHOLD_DAYS and stage != "pago"
                break
        # Walk history to compute lead-times between transitions
        hist = sorted(p.get("billing_history") or [], key=lambda h: h.get("changed_at") or "")
        for prev, curr in zip(hist, hist[1:]):
            d_prev = _iso_to_date(prev.get("changed_at"))
            d_curr = _iso_to_date(curr.get("changed_at"))
            if d_prev and d_curr:
                key = f"{prev.get('stage','')}→{curr.get('stage','')}"
                transition_days.setdefault(key, []).append((d_curr - d_prev).days)
        # Collect stuck projects for the radar list
        if days_in_stage >= STUCK_THRESHOLD_DAYS and stage != "pago":
            stuck_projects.append({
                "id": str(p["_id"]),
                "project_code": p.get("project_code", ""),
                "name": p.get("name", ""),
                "billing_stage": stage,
                "team_name": p.get("team_name", ""),
                "days_in_stage": days_in_stage,
                "actual_value": float(p.get("actual_value") or 0),
                "programmed_value": float(p.get("programmed_value") or 0),
                "entered_stage_at": entered_iso,
            })

    def _avg(lst):
        vs = [v for v in lst if v is not None]
        return round(sum(vs) / len(vs), 1) if vs else 0

    lead_times = {k: {"avg_days": _avg(v), "samples": len(v)} for k, v in transition_days.items()}

    # Aggregate to the 4 "big buckets" the dashboard shows
    def _sum_range(from_key, to_key):
        """Sum all transition_days entries that walk from from_key to to_key (may span intermediates)."""
        # Simplest: consider direct transitions matching from→to
        return transition_days.get(f"{from_key}→{to_key}", [])

    lead_buckets = {
        "recebimento_to_fechamento": _avg(_sum_range("recebimento_tecnico", "em_fechamento") + _sum_range("em_fechamento", "ajuste_material")),
        "fechamento_to_fiscalizacao": _avg(_sum_range("ajuste_material", "pendencia_construtiva") + _sum_range("pendencia_construtiva", "aguardando_fiscalizacao")),
        "fiscalizacao_to_aprovada": _avg(_sum_range("aguardando_fiscalizacao", "digitada") + _sum_range("digitada", "aprovada") + _sum_range("aguardando_fiscalizacao", "aprovada")),
        "aprovada_to_pago": _avg(_sum_range("aprovada", "pago") + _sum_range("aprovada", "digitada") + _sum_range("digitada", "pago")),
    }

    stuck_projects.sort(key=lambda x: -x["days_in_stage"])

    return {
        "pipeline": pipeline,
        "stages": [{"key": k, "label": v} for k, v in BILLING_STAGE_LABELS.items()],
        "totals": totals,
        "per_stage": per_stage_totals,
        "backlog_value": backlog_value,
        "paid_value": paid_value,
        "lead_times": lead_times,
        "lead_buckets": lead_buckets,
        "stuck_projects": stuck_projects,
        "stuck_threshold_days": STUCK_THRESHOLD_DAYS,
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
    # Fev/2026 · Apenas equipes cadastradas — filtra "Sem equipe" e nomes obsoletos
    # Considera "equipe ativa" apenas quando tem pelo menos 1 membro OU supervisor definido
    # (evita placeholders vazios tipo "Equipe 1/2/3" aparecerem na análise)
    teams_docs = await db.teams.find({"user_id": current_user["_id"]}).to_list(1000)
    def _is_active_team(t):
        members = t.get("members") or []
        supervisor = (t.get("supervisor") or "").strip()
        return bool(members) or bool(supervisor)
    registered_names = {
        t.get("name", "").strip()
        for t in teams_docs
        if t.get("name") and _is_active_team(t)
    }
    
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
    
    # Productivity by team (actual / programmed) — SÓ EQUIPES CADASTRADAS
    team_perf = {}
    for p in projects:
        team_name = (p.get("team_name") or "").strip()
        if not team_name or team_name not in registered_names:
            continue
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


# Fev/2026 · KPIs executivos para o gerente na aba Análise ===================
@api_router.get("/analytics/manager-kpis")
async def manager_kpis(
    current_user: dict = Depends(get_current_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[str] = None,
):
    """Agregações executivas para o dashboard gerencial de Análise:
    - Financeiro: aderência ao programa, ticket médio, % faturado, backlog
    - Operacional: ativas, concluídas, atrasadas, paradas > 15d
    - MoM: comparativo mês atual vs mês anterior (produção realizada)
    - Highlights: melhor/pior equipe (produtividade), tipo mais rentável
    - Perdas: horas improdutivas + dias de indisponibilidade no período
    """
    from datetime import timedelta as _td, datetime as _dt, timezone as _tz
    from collections import defaultdict as _dd
    now = _dt.now(_tz.utc)
    today = now.strftime("%Y-%m-%d")

    # Base project query
    q: dict = {"user_id": current_user["_id"]}
    if team_id:
        q["team_id"] = team_id
    projects = await db.projects.find(q).to_list(5000)

    def _dstr(v): return (v or "")[:10]
    def _in_range(iso: str) -> bool:
        if not iso:
            return False
        if start_date and iso < start_date:
            return False
        if end_date and iso > end_date:
            return False
        return True

    # Se filtro de data foi passado, restringe universo por start_date da obra
    if start_date or end_date:
        projects = [p for p in projects if _in_range(_dstr(p.get("start_date")))]

    INACTIVE = ("cancelado", "suspenso")
    active = [p for p in projects if p.get("execution_status") not in INACTIVE]
    completed = [p for p in projects if p.get("execution_status") in ("executada", "concluido")]
    overdue = [p for p in projects if p.get("expiry_date") and _dstr(p["expiry_date"]) < today
               and p.get("execution_status") not in ("executada", "concluido", *INACTIVE)]

    total_programmed = sum(float(p.get("programmed_value") or 0) for p in active)
    total_actual = sum(float(p.get("actual_value") or 0) for p in active)
    total_billing = sum(float(p.get("billing_value") or 0) for p in active)

    adherence_pct = round((total_actual / total_programmed) * 100, 1) if total_programmed else 0.0
    billing_pct = round((total_billing / total_actual) * 100, 1) if total_actual else 0.0
    completion_pct = round((len(completed) / len(projects)) * 100, 1) if projects else 0.0
    avg_ticket = round(total_programmed / len(active), 2) if active else 0.0

    # Prazo médio (dias) para concluídas
    def _days(a, b):
        try:
            da = _dt.fromisoformat(_dstr(a))
            db_ = _dt.fromisoformat(_dstr(b))
            return max(0, (db_ - da).days)
        except Exception:
            return None
    lead_days_list = []
    for p in completed:
        d = _days(p.get("start_date"), p.get("execution_finished_at") or p.get("end_date"))
        if d is not None:
            lead_days_list.append(d)
    avg_lead_days = round(sum(lead_days_list) / len(lead_days_list), 1) if lead_days_list else 0.0

    # Backlog faturamento (parado > 15 dias) — reutiliza scanner existente
    try:
        stuck = await _scan_stuck_billing_projects(threshold_days=15)
        # se team_id filtrar
        if team_id:
            stuck = [s for s in stuck if s.get("team_name") and any(t.get("id") == team_id and t.get("name") == s.get("team_name") for t in [])]
        backlog_count = len(stuck)
        backlog_value = sum(float(s.get("actual_value") or 0) for s in stuck)
    except Exception:
        backlog_count = 0
        backlog_value = 0.0

    # MoM: produção realizada do mês atual vs mês anterior (start_date)
    cur_ym = now.strftime("%Y-%m")
    prev_month = (now.replace(day=1) - _td(days=1))
    prev_ym = prev_month.strftime("%Y-%m")
    all_projects = projects if not (start_date or end_date) else await db.projects.find({"user_id": current_user["_id"]}).to_list(5000)
    cur_actual = sum(float(p.get("actual_value") or 0) for p in all_projects
                     if _dstr(p.get("start_date")).startswith(cur_ym) and p.get("execution_status") not in INACTIVE)
    prev_actual = sum(float(p.get("actual_value") or 0) for p in all_projects
                      if _dstr(p.get("start_date")).startswith(prev_ym) and p.get("execution_status") not in INACTIVE)
    mom_delta_pct = round(((cur_actual - prev_actual) / prev_actual) * 100, 1) if prev_actual else (100.0 if cur_actual else 0.0)

    # Best/worst team (por produtividade actual/programmed) — SÓ EQUIPES CADASTRADAS E ATIVAS
    teams_docs = await db.teams.find({"user_id": current_user["_id"]}).to_list(1000)
    def _is_active_team(t):
        members = t.get("members") or []
        supervisor = (t.get("supervisor") or "").strip()
        return bool(members) or bool(supervisor)
    registered_names = {
        t.get("name", "").strip()
        for t in teams_docs
        if t.get("name") and _is_active_team(t)
    }
    team_map: dict = _dd(lambda: {"team": "", "programmed": 0.0, "actual": 0.0, "count": 0})
    for p in active:
        tn = (p.get("team_name") or "").strip()
        if not tn or tn not in registered_names:
            continue
        team_map[tn]["team"] = tn
        team_map[tn]["programmed"] += float(p.get("programmed_value") or 0)
        team_map[tn]["actual"] += float(p.get("actual_value") or 0)
        team_map[tn]["count"] += 1
    teams_ranked = []
    for t in team_map.values():
        if t["programmed"] > 0:
            teams_ranked.append({
                "name": t["team"],
                "productivity_pct": round(t["actual"] / t["programmed"] * 100, 1),
                "actual": t["actual"], "programmed": t["programmed"], "count": t["count"],
            })
    teams_ranked.sort(key=lambda x: x["productivity_pct"], reverse=True)
    best_team = teams_ranked[0] if teams_ranked else None
    worst_team = teams_ranked[-1] if len(teams_ranked) > 1 else None

    # Tipo mais rentável (por soma de billing_value)
    type_labels = PROJECT_TYPE_LABELS
    type_map: dict = _dd(lambda: {"type": "", "billing": 0.0, "actual": 0.0, "count": 0})
    for p in active:
        pt = p.get("project_type", "anexo_iv")
        label = type_labels.get(pt, pt)
        type_map[label]["type"] = label
        type_map[label]["billing"] += float(p.get("billing_value") or 0)
        type_map[label]["actual"] += float(p.get("actual_value") or 0)
        type_map[label]["count"] += 1
    types_ranked = sorted(type_map.values(), key=lambda x: x["billing"], reverse=True)
    top_type = types_ranked[0] if types_ranked and types_ranked[0]["billing"] > 0 else None

    # Perdas (improdutividade + indisponibilidade) no período
    uq: dict = {"user_id": current_user["_id"]}
    if start_date or end_date:
        rng = {}
        if start_date: rng["$gte"] = start_date
        if end_date: rng["$lte"] = end_date
        uq["date"] = rng
    unprod_docs = await db.team_unproductivity.find(uq).to_list(5000)
    unavail_docs = await db.team_unavailability.find(uq).to_list(5000)
    if team_id:
        unprod_docs = [d for d in unprod_docs if d.get("team_id") == team_id]
        unavail_docs = [d for d in unavail_docs if d.get("team_id") == team_id]
    unprod_hours = round(sum(float(d.get("hours_lost") or 0) for d in unprod_docs), 1)
    unavail_days = len(unavail_docs)

    # Custo estimado das perdas — Set/2026: meta diária DA EQUIPE do registro (jornada comercial de 8h → R$/h = meta ÷ 8)
    _teams_cost = await db.teams.find({"user_id": current_user["_id"]}, {"daily_target": 1}).to_list(1000)
    _target_by_team = {str(t["_id"]): float(t.get("daily_target") or 4000.0) for t in _teams_cost}
    _avg_target = (sum(_target_by_team.values()) / len(_target_by_team)) if _target_by_team else 4000.0
    HOUR_COST = round(_avg_target / 8.0, 2)
    DAY_COST = round(_avg_target, 2)
    unprod_cost = round(sum(float(d.get("hours_lost") or 0) * _target_by_team.get(str(d.get("team_id")), _avg_target) / 8.0 for d in unprod_docs), 2)
    unavail_cost = round(sum(_target_by_team.get(str(d.get("team_id")), _avg_target) for d in unavail_docs), 2)

    # Fev/2026 · Retorno de Programação NÃO executada
    # Obras marcadas como a_reprogramar / cancelado / suspenso no período (start_date dentro do filtro)
    # Prejuízo = soma do valor PROGRAMADO que não foi realizado (programmed - actual, floored a 0)
    RETURN_STATUSES = ("a_reprogramar", "cancelado", "suspenso")
    reschedule_projects = [
        p for p in projects
        if p.get("execution_status") in RETURN_STATUSES
    ]
    reschedule_count = len(reschedule_projects)
    reschedule_lost_value = 0.0
    for p in reschedule_projects:
        prog = float(p.get("programmed_value") or 0)
        act = float(p.get("actual_value") or 0)
        reschedule_lost_value += max(0.0, prog - act)
    reschedule_lost_value = round(reschedule_lost_value, 2)

    # Reagendamentos (histórico) — cada reprogramação de data também é um retorno operacional
    reschedule_events = 0
    for p in projects:
        for h in (p.get("reschedule_history") or []):
            h_date = (h.get("date") or "")[:10] if isinstance(h, dict) else ""
            if start_date and h_date and h_date < start_date:
                continue
            if end_date and h_date and h_date > end_date:
                continue
            reschedule_events += 1

    loss_cost = round(unprod_cost + unavail_cost + reschedule_lost_value, 2)

    # Fev/2026 · Metas contratuais operacionais — agora configuráveis
    DEFAULT_MONTHLY = 336000.0
    DEFAULT_TEAM_DAILY = 4000.0
    # Meta contratual: busca configuração do mês atual (fallback global do usuário → default)
    ct_current = await db.contract_targets.find_one({"user_id": current_user["_id"], "month": cur_ym})
    ct_global = await db.contract_targets.find_one({"user_id": current_user["_id"], "month": "default"})
    MONTHLY_CONTRACT_TARGET = float((ct_current or ct_global or {}).get("target") or DEFAULT_MONTHLY)

    # Meta diária somada = soma da daily_target de cada equipe ATIVA (cadastrada + com membros/supervisor)
    active_teams_docs = [t for t in teams_docs if _is_active_team(t) and (t.get("name") or "").strip() in registered_names]
    active_teams_count = len(active_teams_docs)
    team_name_to_target = {
        (t.get("name") or "").strip(): float(t.get("daily_target") or DEFAULT_TEAM_DAILY)
        for t in active_teams_docs
    }
    daily_target_total = round(sum(team_name_to_target.values()), 2)
    # Meta média por equipe (para exibir na UI)
    team_daily_avg = round(daily_target_total / active_teams_count, 2) if active_teams_count else DEFAULT_TEAM_DAILY

    # Meta atingida no mês corrente (produção realizada)
    monthly_actual = float(cur_actual or 0)
    monthly_pct = round((monthly_actual / MONTHLY_CONTRACT_TARGET) * 100, 1) if MONTHLY_CONTRACT_TARGET else 0.0
    monthly_gap = round(max(0.0, MONTHLY_CONTRACT_TARGET - monthly_actual), 2)

    # Aderência por equipe: produção realizada / (daily_target × dias úteis)
    from calendar import monthrange as _mrange
    _y, _m = now.year, now.month
    _dim = _mrange(_y, _m)[1]
    _business_days = sum(1 for _d in range(1, _dim + 1) if _dt(_y, _m, _d).weekday() < 5)
    team_daily_perf = []
    for tn in registered_names:
        tp = team_map.get(tn) or {"actual": 0.0, "programmed": 0.0, "count": 0, "team": tn}
        team_actual = float(tp.get("actual") or 0)
        t_daily = team_name_to_target.get(tn, DEFAULT_TEAM_DAILY)
        expected_month = t_daily * _business_days
        pct_meta = round((team_actual / expected_month) * 100, 1) if expected_month else 0.0
        team_daily_perf.append({
            "name": tn,
            "actual": team_actual,
            "daily_target": t_daily,
            "expected_monthly": round(expected_month, 2),
            "meta_pct": pct_meta,
        })
    team_daily_perf.sort(key=lambda x: x["meta_pct"], reverse=True)

    # Alerta de Meta: dispara quando <25% dos dias úteis restantes E <75% da meta atingida
    today_dt = now.date()
    business_days_passed = sum(
        1 for _d in range(1, _dim + 1)
        if _dt(_y, _m, _d).weekday() < 5 and _dt(_y, _m, _d).date() <= today_dt
    )
    business_days_remaining = max(0, _business_days - business_days_passed)
    days_remaining_pct = round((business_days_remaining / _business_days) * 100, 1) if _business_days else 0.0
    meta_alert_active = (days_remaining_pct < 25) and (monthly_pct < 75) and (business_days_remaining > 0)
    meta_alert_severity = "critical" if monthly_pct < 50 else "warning"
    meta_alert_message = (
        f"Faltam apenas {business_days_remaining} dia(s) útil(is) para o fim do mês "
        f"e você está em {monthly_pct:.1f}% da meta contratual. "
        f"Recuperar R$ {monthly_gap:,.2f} exige R$ {(monthly_gap / max(1, business_days_remaining)):,.2f}/dia."
        .replace(",", "X").replace(".", ",").replace("X", ".")
    ) if meta_alert_active else ""

    return {
        "financial": {
            "total_programmed": total_programmed,
            "total_actual": total_actual,
            "total_billing": total_billing,
            "adherence_pct": adherence_pct,        # produção realizada / programado
            "billing_pct": billing_pct,            # faturado / realizado
            "avg_ticket": avg_ticket,
            "backlog_count": backlog_count,
            "backlog_value": backlog_value,
        },
        "operational": {
            "total": len(projects),
            "active": len(active),
            "completed": len(completed),
            "overdue": len(overdue),
            "completion_pct": completion_pct,
            "avg_lead_days": avg_lead_days,
        },
        "mom": {
            "current_month": cur_ym,
            "previous_month": prev_ym,
            "current_actual": cur_actual,
            "previous_actual": prev_actual,
            "delta_pct": mom_delta_pct,
        },
        "highlights": {
            "best_team": best_team,
            "worst_team": worst_team,
            "top_type": top_type,
            "teams_ranked": teams_ranked,
        },
        "losses": {
            "unproductive_hours": unprod_hours,
            "unproductive_cost": unprod_cost,
            "unavailable_days": unavail_days,
            "unavailable_cost": unavail_cost,
            "reschedule_count": reschedule_count,
            "reschedule_events": reschedule_events,
            "reschedule_lost_value": reschedule_lost_value,
            "estimated_cost": loss_cost,
            "hour_cost": HOUR_COST,
            "day_cost": DAY_COST,
        },
        "targets": {
            "monthly_contract": MONTHLY_CONTRACT_TARGET,
            "team_daily": team_daily_avg,
            "active_teams_count": active_teams_count,
            "daily_target_total": daily_target_total,
            "monthly_actual": monthly_actual,
            "monthly_pct": monthly_pct,
            "monthly_gap": monthly_gap,
            "business_days_in_month": _business_days,
            "business_days_passed": business_days_passed,
            "business_days_remaining": business_days_remaining,
            "team_daily_perf": team_daily_perf,
        },
        "alert": {
            "meta_active": meta_alert_active,
            "severity": meta_alert_severity,
            "message": meta_alert_message,
        },
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
    
    # Fev/2026 · colunas dinâmicas por tipo de relatório
    if report_type == "carteira":
        # Carteira: incluir Data Recebimento e Data Vencimento explicitamente
        headers = [
            "Código", "Nome", "Tipo", "Equipe", "Localidade",
            "Data Recebimento", "Início Programado", "Data Vencimento (Fim)",
            "Valor Programado", "Prod. Realizada", "Faturamento",
            "Status Execução", "Status Faturamento", "Material", "Prioridade", "Observações",
        ]
    elif report_type == "programacao":
        # Programação: incluir Observações (motivo cancelamento / suspensão / desligamento)
        headers = [
            "Código", "Nome", "Tipo", "Equipe", "Localidade", "Início", "Fim",
            "Valor Programado", "Meta Diária", "Prod. Realizada", "Faturamento",
            "Status Execução", "Motivo Cancelamento/Suspensão", "Desligamento",
            "Material", "Linha Viva", "Prioridade", "Observações Gerais",
        ]
    else:
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
        exec_lbl = EXECUTION_STATUS_LABELS.get(p.get("execution_status"), p.get("execution_status", ""))
        material_lbl = {"complete": "Total", "partial": "Parcial", "pending": "Pendente"}.get(p.get("material_status"), p.get("material_status", ""))
        prio_lbl = {"high": "Alta", "medium": "Média", "low": "Baixa"}.get(p.get("priority"), p.get("priority", ""))
        cancel_reason = (p.get("cancel_reason") or "").strip()
        shutdown_info = (p.get("shutdown_info") or "").strip()
        notes = (p.get("notes") or "").strip()
        obs_geral = " | ".join([x for x in [cancel_reason, shutdown_info, notes] if x]) or "-"

        if report_type == "carteira":
            billing_stage_label = p.get("billing_stage", "") or "-"
            ws.append([
                p.get("project_code", "") or "-",
                p.get("name", ""),
                PROJECT_TYPE_LABELS.get(p.get("project_type"), p.get("project_type", "")),
                p.get("team_name", "") or "-",
                p.get("location", "") or "-",
                (p.get("received_date") or "")[:10] or "-",
                (p.get("start_date") or "")[:10] or "-",
                (p.get("end_date") or "")[:10] or "-",
                p.get("programmed_value", 0),
                p.get("actual_value", 0),
                p.get("billing_value", 0),
                exec_lbl,
                billing_stage_label,
                material_lbl,
                prio_lbl,
                obs_geral,
            ])
        elif report_type == "programacao":
            # Observação motivo: sai preenchido especialmente para canceladas/suspensas
            motivo = cancel_reason if p.get("execution_status") in ("cancelado", "suspenso") else "-"
            ws.append([
                p.get("project_code", "") or "-",
                p.get("name", ""),
                PROJECT_TYPE_LABELS.get(p.get("project_type"), p.get("project_type", "")),
                p.get("team_name", "") or "-",
                p.get("location", "") or "-",
                (p.get("start_date") or "")[:10],
                (p.get("end_date") or "")[:10],
                p.get("programmed_value", 0),
                p.get("daily_goal", 0),
                p.get("actual_value", 0),
                p.get("billing_value", 0),
                exec_lbl,
                motivo,
                shutdown_info or "-",
                material_lbl,
                "Sim" if p.get("requires_hot_line") else "Não",
                prio_lbl,
                notes or "-",
            ])
        else:
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
                exec_lbl,
                material_lbl,
                "Sim" if p.get("requires_hot_line") else "Não",
                shutdown_info or "-",
                prio_lbl,
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
    api_key, sender = await _resend_credentials(db)
    if not api_key:
        logger.warning(f"[EMAIL SKIPPED - No RESEND_API_KEY] To={recipients} Subject={subject}")
        return {"status": "skipped", "reason": "no_api_key"}
    try:
        import resend
        resend.api_key = api_key
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
    
    recipients = await _notification_emails(db)
    if not recipients:
        return {"status": "no_recipients"}
    
    html = _build_project_email_html(project, "Programação de Obra")
    subject = f"[HAYAH] Programação: {project.get('name','')} - {(project.get('start_date') or '')[:10]}"
    return await send_email_via_resend(recipients, subject, html)

async def daily_scheduled_email_job():
    """Runs daily at 18:00 to send tomorrow's scheduled projects"""
    from datetime import date, timedelta as td
    tomorrow = (datetime.now(timezone.utc) + td(days=1)).strftime("%Y-%m-%d")
    
    recipients = await _notification_emails(db)
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
    recipients = await _notification_emails(db)
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

# --- Aviso de Backlog Faturamento (Fev/2026) ---
async def _scan_stuck_billing_projects(threshold_days: int = 15) -> list:
    """Return billing projects stuck > threshold_days in the same stage (excluding 'pago')."""
    from datetime import datetime as _dt, timezone as _tz
    today = _dt.now(_tz.utc).date()

    def _iso_to_date(s: str):
        try:
            return _dt.fromisoformat((s or "")[:10]).date()
        except Exception:
            return None

    projects = await db.projects.find({"billing_stage": {"$nin": ["", "pago"]}}).to_list(5000)
    stuck: list = []
    for p in projects:
        stage = p.get("billing_stage") or ""
        if not stage:
            continue
        hist = p.get("billing_history") or []
        entered_iso = ""
        for h in reversed(hist):
            if h.get("stage") == stage:
                entered_iso = h.get("changed_at") or ""
                break
        if not entered_iso:
            entered_iso = (p.get("closed_at") or p.get("updated_at") or "")
        entered_d = _iso_to_date(entered_iso)
        if not entered_d:
            continue
        days = (today - entered_d).days
        if days >= threshold_days:
            stuck.append({
                "id": str(p["_id"]),
                "project_code": p.get("project_code", ""),
                "name": p.get("name", ""),
                "team_name": p.get("team_name", ""),
                "billing_stage": stage,
                "days_in_stage": days,
                "actual_value": float(p.get("actual_value") or 0),
                "programmed_value": float(p.get("programmed_value") or 0),
                "entered_stage_at": entered_iso,
            })
    stuck.sort(key=lambda x: -x["days_in_stage"])
    return stuck


async def backlog_daily_check_job():
    """Runs daily at 09:15 America/Cuiaba - push notification when billing projects are stuck > 15 days."""
    try:
        stuck = await _scan_stuck_billing_projects(threshold_days=15)
        if not stuck:
            logger.info("Backlog check: no stuck projects")
            return
        total_value = sum(s.get("actual_value") or s.get("programmed_value") or 0 for s in stuck)
        top = stuck[:3]
        preview = " · ".join([f"{s['project_code'] or s['name']} ({s['days_in_stage']}d)" for s in top])
        try:
            await broadcast_push(db, {
                "title": f"⚠️ Backlog Faturamento — {len(stuck)} obra(s) parada(s)",
                "body": f"R$ {total_value:,.0f} (produção realizada) presos há mais de 15 dias. {preview}".replace(",", "."),
                "url": "/faturamento",
                "tag": "backlog-radar",
                "requireInteraction": True,
            })
            logger.info(f"Backlog push sent: {len(stuck)} stuck projects, R$ {total_value:.2f} at risk")
        except Exception as e:
            logger.warning(f"Backlog push failed: {e}")
    except Exception as e:
        logger.error(f"backlog_daily_check_job error: {e}")


@api_router.get("/faturamento/backlog-alerts")
async def get_backlog_alerts(current_user: dict = Depends(get_current_user)):
    """Return stuck-billing projects (> 15 days) for the current user's dashboard."""
    stuck = await _scan_stuck_billing_projects(threshold_days=15)
    return {
        "count": len(stuck),
        "threshold_days": 15,
        "total_value": sum(s.get("actual_value") or s.get("programmed_value") or 0 for s in stuck),
        "items": stuck,
    }


@api_router.post("/faturamento/backlog-alerts/notify")
async def trigger_backlog_notify(current_user: dict = Depends(get_current_user)):
    """Manually trigger the backlog push broadcast. Useful for testing or 'republish' cases."""
    await backlog_daily_check_job()
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
    photos = [_photo_public(project_id, p) for p in (project.get("photos") or [])]
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
    point: str = Form(""),  # Fev/2026 — ponto (P1, P2, P3...)
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Set/2026: foto vai para o object storage (não mais base64 dentro do documento da obra —
    isso estourava o limite de 16MB do Mongo após poucas fotos e travava a fila de sync)."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]}, {"_id": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Foto maior que 15MB — reduza a resolução")
    ct = file.content_type or "image/jpeg"
    ext = {"image/png": "png", "image/webp": "webp"}.get(ct, "jpg")
    photo_id = secrets.token_urlsafe(8)
    path = f"{APP_NAME}/obras/{current_user['_id']}/{project_id}/{photo_id}.{ext}"
    try:
        result = await storage_put(path, content, ct)
    except Exception as e:
        logger.error(f"photo storage failed: {e}")
        raise HTTPException(status_code=502, detail="Falha ao gravar a foto no armazenamento. Tente novamente.")
    photo = {
        "id": photo_id,
        "label": label,
        "point": (point or "").strip().upper()[:12],
        "storage_path": result.get("path", path),
        "content_type": ct,
        "size": len(content),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": current_user.get("name", ""),
    }
    await db.projects.update_one({"_id": safe_object_id(project_id)}, {"$push": {"photos": photo}})
    return _photo_public(project_id, photo)


def _photo_public(project_id: str, photo: dict) -> dict:
    """Foto com `data_url` apontando para o endpoint de arquivo (compatível com o frontend legado)."""
    out = {k: v for k, v in photo.items() if k != "data_url"}
    if photo.get("data_url"):
        out["data_url"] = photo["data_url"]
    else:
        out["data_url"] = f"/api/operacional/photos/{project_id}/{photo.get('id')}/file"
    return out


@api_router.get("/operacional/photos/{project_id}/{photo_id}/file")
async def get_photo_file(project_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]}, {"photos": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    photo = next((p for p in (project.get("photos") or []) if p.get("id") == photo_id), None)
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    if photo.get("data_url"):
        header, b64 = photo["data_url"].split(",", 1)
        ct = header[5:].split(";")[0] or "image/jpeg"
        return Response(content=base64.b64decode(b64), media_type=ct, headers={"Cache-Control": "private, max-age=86400"})
    data, ct = await storage_get(photo["storage_path"])
    return Response(content=data, media_type=photo.get("content_type") or ct, headers={"Cache-Control": "private, max-age=86400"})

@api_router.delete("/operacional/photos/{project_id}/{photo_id}")
async def delete_photo(project_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"]},
        {"$pull": {"photos": {"id": photo_id}}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}

# ============ Relatórios adicionais (Fev/2026) ============
@api_router.get("/reports/teams")
async def report_teams_csv(current_user: dict = Depends(get_current_user), start: str = "", end: str = ""):
    """Produção por equipe: obras · executadas · valor programado · valor faturado · % pagos."""
    teams = await db.teams.find({"user_id": current_user["_id"]}).to_list(500)
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(5000)
    def in_range(p):
        ps = (p.get("start_date") or "")[:10]
        if start and ps and ps < start: return False
        if end and ps and ps > end: return False
        return True
    filtered = [p for p in projects if in_range(p)]
    lines = ["Equipe,Codigo,Obras Total,Concluidas,Vencidas,No Prazo,Valor Programado,Valor Faturado,% Pago"]
    today_s = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for t in teams:
        tid = str(t["_id"])
        team_projects = [p for p in filtered if (p.get("team_id") == tid) or any(tid in (e.get("team_ids") or []) for e in (p.get("schedule_entries") or []))]
        if not team_projects: continue
        total = len(team_projects)
        done = sum(1 for p in team_projects if p.get("execution_status") == "concluido")
        vencidas = sum(1 for p in team_projects if p.get("execution_status") not in ("concluido", "cancelado") and (p.get("end_date") or "9999") < today_s)
        no_prazo = total - vencidas
        val_prog = sum(float(p.get("programmed_value") or 0) for p in team_projects)
        val_fat = sum(float(p.get("invoice_value") or 0) for p in team_projects)
        pagos = sum(1 for p in team_projects if p.get("billing_stage") == "pago")
        pct_pago = round(pagos / total * 100, 1) if total else 0
        lines.append(f'"{t.get("name","")}","{t.get("code","")}",{total},{done},{vencidas},{no_prazo},{val_prog:.2f},{val_fat:.2f},{pct_pago}')
    csv = "\n".join(lines)
    return Response(content="\ufeff" + csv, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="rel_equipes_{datetime.now().strftime("%Y%m%d")}.csv"'})


@api_router.get("/reports/unavailability")
async def report_unavailability_csv(current_user: dict = Depends(get_current_user), start: str = "", end: str = ""):
    """Indisponibilidade: por dia · equipe · motivo."""
    q = {"user_id": current_user["_id"]}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        q["date"] = rng
    docs = await db.team_unavailability.find(q).sort("date", -1).to_list(5000)
    lines = ["Data,Equipe,Motivo,Observacao"]
    for d in docs:
        notes = (d.get("notes","") or "").replace('"', '')
        lines.append(f'{d.get("date","")},"{d.get("team_name","")}","{d.get("reason","")}","{notes}"')
    return Response(content="\ufeff" + "\n".join(lines), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="rel_indisponibilidade_{datetime.now().strftime("%Y%m%d")}.csv"'})


@api_router.get("/reports/unproductivity")
async def report_unproductivity_csv(current_user: dict = Depends(get_current_user), start: str = "", end: str = ""):
    """Improdutividade: por dia · equipe · motivo · horas perdidas."""
    q = {"user_id": current_user["_id"]}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        q["date"] = rng
    docs = await db.team_unproductivity.find(q).sort("date", -1).to_list(5000)
    lines = ["Data,Equipe,Motivo,Horas Perdidas,Observacao"]
    total_h = 0.0
    for d in docs:
        h = float(d.get("hours_lost") or 0)
        total_h += h
        notes = (d.get("notes","") or "").replace('"', '')
        lines.append(f'{d.get("date","")},"{d.get("team_name","")}","{d.get("reason","")}",{h:.1f},"{notes}"')
    lines.append(f',,"TOTAL",{total_h:.1f},')
    return Response(content="\ufeff" + "\n".join(lines), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="rel_improdutividade_{datetime.now().strftime("%Y%m%d")}.csv"'})


@api_router.get("/reports/returns")
async def report_returns_csv(current_user: dict = Depends(get_current_user), start: str = "", end: str = ""):
    """Retorno da programacao: obras executadas / a reprogramar / motivo."""
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(5000)
    lines = ["Data Programada,Codigo Obra,Nome Obra,Equipe,Status Retorno,Motivo Cancelamento,Valor Programado"]
    def in_range(d):
        if not d: return False
        d = d[:10]
        if start and d < start: return False
        if end and d > end: return False
        return True
    for p in projects:
        dates = set()
        for e in (p.get("schedule_entries") or []):
            if e.get("start_date"): dates.add(e["start_date"][:10])
            if e.get("end_date"): dates.add(e["end_date"][:10])
        if not dates and p.get("start_date"): dates.add(p["start_date"][:10])
        for d in sorted(dates):
            if (start or end) and not in_range(d): continue
            es = p.get("execution_status") or ""
            if es == "concluido":
                status_ret = "executada"
            elif es in ("a_reprogramar", "cancelado", "suspenso"):
                status_ret = "a_reprogramar"
            else:
                status_ret = "programada"
            cancel_reason = (p.get("cancel_reason","") or "").replace('"', '')
            lines.append(f'{d},"{p.get("project_code","")}","{p.get("name","")}","{p.get("team_name","")}",{status_ret},"{cancel_reason}",{float(p.get("programmed_value") or 0):.2f}')
    return Response(content="\ufeff" + "\n".join(lines), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="rel_retorno_programacao_{datetime.now().strftime("%Y%m%d")}.csv"'})



# --- Diário de Obra (PDF) ---
@api_router.get("/operacional/daily-log/{project_id}")
async def daily_log_pdf(project_id: str, notes: str = "", current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    checklist = project.get("checklist", {}) or {}
    photos = []
    for ph in (project.get("photos", []) or []):
        if not ph.get("data_url") and ph.get("storage_path"):
            try:
                data, ct = await storage_get(ph["storage_path"])
                ph = {**ph, "data_url": f"data:{ph.get('content_type') or ct or 'image/jpeg'};base64,{base64.b64encode(data).decode('ascii')}"}
            except Exception as e:
                logger.warning(f"daily-log photo load failed: {e}")
                continue
        photos.append(ph)
    pdf_bytes = await asyncio.to_thread(build_daily_log_pdf, project, checklist, photos, notes)
    filename = f"diario_obra_{(project.get('project_code') or project_id)[:24]}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class DailyLogJobBody(BaseModel):
    notes: str = ""
    date_from: str = ""
    date_to: str = ""
    point: str = ""
    photo_ids: Optional[List[str]] = None
    max_photos: int = 500


@api_router.get("/operacional/daily-log/{project_id}/photos")
async def daily_log_photo_catalog(project_id: str, current_user: dict = Depends(get_current_user)):
    """Catálogo leve de fotos da obra (sem binário) para o modal do Diário: datas e pontos disponíveis."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]}, {"photos": 1, "project_code": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    out = []
    for ph in (project.get("photos") or []):
        if not (ph.get("storage_path") or (ph.get("data_url") or "").startswith("data:image")):
            continue
        out.append({"id": ph.get("id"), "point": (ph.get("point") or "").strip(), "label": (ph.get("label") or "").upper(), "uploaded_at": ph.get("uploaded_at") or "",
                    "date": (ph.get("uploaded_at") or "")[:10], "thumb": f"/api/operacional/photos/{project_id}/{ph.get('id')}/file"})
    out.sort(key=lambda x: x["uploaded_at"], reverse=True)
    dates = sorted({x["date"] for x in out if x["date"]})
    points = sorted({x["point"] for x in out if x["point"]}, key=lambda s: (len(s), s))
    return {"photos": out, "count": len(out), "dates": dates, "points": points}


@api_router.post("/operacional/daily-log/{project_id}/job")
async def daily_log_pdf_job(project_id: str, body: DailyLogJobBody, current_user: dict = Depends(get_current_user)):
    """Set/2026 · Diário de Obra pesado (até 500 fotos) gerado em segundo plano com progresso."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    checklist = project.get("checklist", {}) or {}
    chosen = []
    wanted = set(body.photo_ids or [])
    for ph in (project.get("photos") or []):
        if not (ph.get("storage_path") or (ph.get("data_url") or "").startswith("data:image")):
            continue
        d = (ph.get("uploaded_at") or "")[:10]
        if wanted and ph.get("id") not in wanted:
            continue
        if body.date_from and d and d < body.date_from[:10]:
            continue
        if body.date_to and d and d > body.date_to[:10]:
            continue
        if body.point and (ph.get("point") or "").strip().upper() != body.point.strip().upper():
            continue
        chosen.append(ph)
    chosen = chosen[: max(1, min(int(body.max_photos or 500), 500))]
    total = len(chosen)
    notes = body.notes or ""

    async def runner(progress):
        progress(0, total, f"Preparando {total} foto(s)…")
        sem = asyncio.Semaphore(8)
        done = {"n": 0}

        async def _one(ph):
            async with sem:
                try:
                    if ph.get("storage_path"):
                        data, _ct = await storage_get(ph["storage_path"])
                    else:
                        data = base64.b64decode(ph["data_url"].split(",", 1)[1])
                    small = await asyncio.to_thread(_shrink_photo, data, 900, 72)
                    return {**ph, "data_url": "", "bytes": small}
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"daily-log job photo {ph.get('id')} ignorada: {e}")
                    return None
                finally:
                    done["n"] += 1
                    progress(done["n"], total, f"Processando fotos {done['n']}/{total}…")

        results = await asyncio.gather(*[_one(ph) for ph in chosen])
        photos = [r for r in results if r]
        progress(total, total, "Montando o PDF…")
        return await asyncio.to_thread(build_daily_log_pdf, project, checklist, photos, notes)

    filename = f"diario_obra_{''.join(ch if ch.isalnum() else '_' for ch in (project.get('project_code') or project_id))[:24]}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.pdf"
    return _pdf_jobs.start_job(current_user["_id"], "diario", filename, runner)

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
    
    recipients = await _notification_emails(db)
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
                "shutdown_dates": p.get("shutdown_dates", []) or [],
                "hot_line_dates": p.get("hot_line_dates", []) or [],
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
    """Obras com a data de HOJE no calendário da equipe (schedule_entries) — agrupadas pela equipe daquela data."""
    from datetime import datetime as dt
    try:
        from zoneinfo import ZoneInfo
        today = dt.now(ZoneInfo("America/Cuiaba")).strftime("%Y-%m-%d")
    except Exception:
        today = dt.now(timezone.utc).strftime("%Y-%m-%d")
    projects = await db.projects.find({
        "user_id": current_user["_id"],
        "is_scheduled": True,
        "execution_status": {"$nin": ["concluido", "cancelado", "suspenso"]},
    }).to_list(2000)

    grouped: dict = {}
    today_projects: list = []
    _allowed_teams = await _campo.allowed_team_names(db, current_user)
    _pids = [str(p["_id"]) for p in projects]
    _checkins = await _campo.checkins_by_project(db, current_user["_id"], today, _pids)
    _apr_counts = await _campo.apr_counts(db, current_user["_id"], _pids)
    for p in projects:
        entries = p.get("schedule_entries") or []
        teams_today: list = []
        if entries:
            for e in entries:
                if (e.get("date") or "")[:10] != today:
                    continue
                names = e.get("team_names") or []
                ids = e.get("team_ids") or []
                if not names and ids:
                    names = [(await db.teams.find_one({"_id": safe_object_id(t)}) or {}).get("name", "") for t in ids]
                teams_today.extend([n for n in names if n] or ["Sem equipe"])
        elif (p.get("start_date") or "")[:10] == today:
            teams_today = [n for n in [p.get("team_name"), p.get("additional_team_name")] if n] or ["Sem equipe"]
        if not teams_today:
            continue
        if _allowed_teams is not None and not (set(teams_today) & _allowed_teams):
            continue
        today_projects.append(p)
        item = build_project_response(p).model_dump()
        item["shutdown_today"] = today in (p.get("shutdown_dates") or []) or (not p.get("shutdown_dates") and bool(p.get("shutdown_info")))
        item["hot_line_today"] = _campo.hot_line_on(p, today)
        item["teams_today"] = sorted(set(teams_today))
        _campo.enrich_item(item, p, _checkins, _apr_counts)
        for name in item["teams_today"]:
            if _allowed_teams is not None and name not in _allowed_teams:
                continue
            grouped.setdefault(name, []).append(item)

    total_value = sum(p.get("programmed_value", 0) for p in today_projects)
    hot_line_count = sum(1 for p in today_projects if _campo.hot_line_on(p, today))

    return {
        "date": today,
        "total_projects": len(today_projects),
        "total_value": total_value,
        "hot_line_count": hot_line_count,
        "by_team": grouped,
    }


# ============ Equipamentos Almoxarifado (Fev/2026) ============
# Transformadores, religadores, reguladores de tensão — rastreio com fotos + patrimônio

class EquipamentoBody(BaseModel):
    tipo: str = "transformador"  # transformador | religador | regulador_tensao
    patrimonio: str = ""
    numero_serie: str = ""
    codigo_material: str = ""
    descricao: str = ""
    potencia: str = ""
    data_fabricacao: str = ""
    condicao: str = "novo"  # novo | reforma
    fabricante: str = ""
    tensao_primaria: str = ""
    tensao_secundaria: str = ""
    notas: str = ""
    # Vínculo com a obra (Set/2026)
    project_id: str = ""
    project_code: str = ""
    project_name: str = ""


@api_router.get("/equipamentos")
async def list_equipamentos(current_user: dict = Depends(get_current_user), tipo: str = "", project_id: str = ""):
    q = {"user_id": current_user["_id"]}
    if tipo:
        q["tipo"] = tipo
    if project_id:
        q["project_id"] = project_id
    docs = await db.equipamentos.find(q).sort("created_at", -1).to_list(2000)
    return [{
        "id": str(d["_id"]),
        "tipo": d.get("tipo", "transformador"),
        "patrimonio": d.get("patrimonio", ""),
        "numero_serie": d.get("numero_serie", ""),
        "codigo_material": d.get("codigo_material", ""),
        "descricao": d.get("descricao", ""),
        "potencia": d.get("potencia", ""),
        "data_fabricacao": d.get("data_fabricacao", ""),
        "condicao": d.get("condicao", "novo"),
        "fabricante": d.get("fabricante", ""),
        "tensao_primaria": d.get("tensao_primaria", ""),
        "tensao_secundaria": d.get("tensao_secundaria", ""),
        "notas": d.get("notas", ""),
        "project_id": d.get("project_id", "") or "",
        "project_code": d.get("project_code", "") or "",
        "project_name": d.get("project_name", "") or "",
        "photos": [p for p in (d.get("photos", []) or []) if not p.get("is_deleted")],
        "created_at": (d.get("created_at").isoformat() if hasattr(d.get("created_at"), "isoformat") else d.get("created_at", "")),
        "created_by": d.get("created_by", ""),
    } for d in docs]


@api_router.post("/equipamentos")
async def create_equipamento(body: EquipamentoBody, current_user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc.update({
        "user_id": current_user["_id"],
        "created_at": datetime.now(timezone.utc),
        "created_by": current_user.get("name", ""),
        "photos": [],
    })
    r = await db.equipamentos.insert_one(doc)
    return {"id": str(r.inserted_id), **body.model_dump(), "photos": []}


@api_router.patch("/equipamentos/{equip_id}")
async def update_equipamento(equip_id: str, body: EquipamentoBody, current_user: dict = Depends(get_current_user)):
    r = await db.equipamentos.update_one(
        {"_id": safe_object_id(equip_id), "user_id": current_user["_id"]},
        {"$set": body.model_dump()},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    return {"status": "updated"}


@api_router.delete("/equipamentos/{equip_id}")
async def delete_equipamento(equip_id: str, current_user: dict = Depends(get_current_user)):
    await db.equipamentos.delete_one({"_id": safe_object_id(equip_id), "user_id": current_user["_id"]})
    return {"status": "deleted"}


@api_router.post("/equipamentos/{equip_id}/photos")
async def upload_equipamento_photo(
    equip_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    equip = await db.equipamentos.find_one({"_id": safe_object_id(equip_id), "user_id": current_user["_id"]})
    if not equip:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    existing = [p for p in (equip.get("photos", []) or []) if not p.get("is_deleted")]
    if len(existing) >= 3:
        raise HTTPException(status_code=400, detail="Máximo de 3 fotos por equipamento")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Foto maior que 10MB")

    # Fev/2026 · watermark automático com patrimônio + data/hora Cuiabá
    patrimonio = (equip.get("patrimonio") or "").strip() or "SEM PATRIMÔNIO"
    tipo_lbl = {"transformador": "TRAFO", "religador": "REL", "regulador_tensao": "REG"}.get(equip.get("tipo", ""), "EQUIP")
    watermarked_bytes, out_ct = await asyncio.to_thread(_apply_photo_watermark, content, file.content_type or "image/jpeg", patrimonio, tipo_lbl)

    fname = file.filename or "foto.jpg"
    ext = "jpg"  # sempre JPEG após watermark
    path = f"{APP_NAME}/equipamentos/{current_user['_id']}/{uuid.uuid4()}.{ext}"
    result = await storage_put(path, watermarked_bytes, out_ct)
    photo = {
        "id": secrets.token_urlsafe(10),
        "filename": fname,
        "size": result.get("size", len(watermarked_bytes)),
        "content_type": out_ct,
        "storage_path": result["path"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": current_user.get("name", ""),
        "watermark": {"patrimonio": patrimonio, "tipo": tipo_lbl},
        "is_deleted": False,
    }
    await db.equipamentos.update_one(
        {"_id": safe_object_id(equip_id)},
        {"$push": {"photos": photo}}
    )
    return photo


def _apply_photo_watermark(image_bytes: bytes, content_type: str, patrimonio: str, tipo_lbl: str) -> tuple[bytes, str]:
    """Aplica um carimbo semi-transparente no rodapé da foto com patrimônio + data/hora Cuiabá + tipo.
    Fev/2026 — para relatório TCP e rastreio."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        # Corrigir orientação EXIF (fotos de celular vêm rotacionadas)
        try:
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass
        img = img.convert("RGB")
        w, h = img.size

        # Escala do carimbo baseada na largura (11% da largura)
        band_height = max(60, int(h * 0.09))
        font_size_big = max(20, int(band_height * 0.42))
        font_size_small = max(14, int(band_height * 0.28))

        # Fontes — fallback default se não achar DejaVu
        try:
            font_big = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size_big)
            font_small = ImageFont.truetype("DejaVuSans.ttf", font_size_small)
        except Exception:
            font_big = ImageFont.load_default()
            font_small = ImageFont.load_default()

        # Overlay semi-transparente no rodapé
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        draw.rectangle([(0, h - band_height), (w, h)], fill=(0, 0, 0, 180))

        # Texto
        cuiaba_now = datetime.now(ZoneInfo("America/Cuiaba"))
        ts_str = cuiaba_now.strftime("%d/%m/%Y %H:%M")
        header = f"HAYAH ENERGY · {tipo_lbl} · PAT {patrimonio}"
        footer = f"{ts_str} · America/Cuiaba"

        pad_x = int(w * 0.02)
        y0 = h - band_height + int(band_height * 0.10)
        y1 = h - band_height + int(band_height * 0.55)

        draw.text((pad_x, y0), header, font=font_big, fill=(224, 255, 0, 255))
        draw.text((pad_x, y1), footer, font=font_small, fill=(255, 255, 255, 220))

        # Selo lateral direito com hora grande para leitura rápida
        try:
            time_only = cuiaba_now.strftime("%H:%M")
            tw = draw.textlength(time_only, font=font_big) if hasattr(draw, "textlength") else font_big.getlength(time_only)
            draw.text((w - int(tw) - pad_x, (y0 + y1) // 2 - font_size_big // 2), time_only, font=font_big, fill=(0, 240, 255, 255))
        except Exception:
            pass

        img = img.convert("RGBA")
        img = Image.alpha_composite(img, overlay).convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=88, optimize=True)
        return out.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning(f"watermark failed, storing original: {e}")
        return image_bytes, content_type


@api_router.get("/equipamentos/{equip_id}/photos/{photo_id}")
async def download_equipamento_photo(equip_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    equip = await db.equipamentos.find_one({"_id": safe_object_id(equip_id), "user_id": current_user["_id"]})
    if not equip:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    photo = next((p for p in (equip.get("photos", []) or []) if p.get("id") == photo_id and not p.get("is_deleted")), None)
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    data, ct = await storage_get(photo["storage_path"])
    return Response(content=data, media_type=photo.get("content_type") or ct)


@api_router.delete("/equipamentos/{equip_id}/photos/{photo_id}")
async def delete_equipamento_photo(equip_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    await db.equipamentos.update_one(
        {"_id": safe_object_id(equip_id), "user_id": current_user["_id"], "photos.id": photo_id},
        {"$set": {"photos.$.is_deleted": True}}
    )
    return {"status": "deleted"}


# Material request with PDF attachments

@api_router.post("/projects/{project_id}/attachments")
async def upload_project_attachment(
    project_id: str,
    kind: str = Form("projeto"),  # projeto | materiais | apr | croqui | dwg | fotos_ext | project_pdf (legacy) | material_pdf (legacy) | other
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    # Normalize legacy kinds
    kind_alias = {"project_pdf": "projeto", "material_pdf": "materiais"}
    kind = kind_alias.get((kind or "").lower(), (kind or "projeto").lower())
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
    download: int = 0,
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
    fname = att.get("filename") or "arquivo"
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    # Set/2026 · DWG/DXF saem sempre como download binário com o nome original (abrir "inline" corrompia a extensão/versão no AutoCAD)
    binary_ext = {"dwg", "dxf", "ifc", "dwf", "zip", "rar", "xlsx", "xls", "docx", "doc", "kmz", "kml"}
    media = att.get("content_type") or ct or "application/octet-stream"
    if ext in binary_ext:
        media = {"dwg": "application/acad", "dxf": "application/dxf"}.get(ext, media if media != "application/octet-stream" else "application/octet-stream")
    disposition = "attachment" if (download or ext in binary_ext) else "inline"
    safe_name = "".join(ch if ch.isalnum() or ch in "._- ()" else "_" for ch in fname)
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'{disposition}; filename="{safe_name}"', "Content-Length": str(len(data)), "Cache-Control": "private, max-age=0"},
    )


@api_router.get("/projects/{project_id}/documentos")
async def project_documentos(project_id: str, current_user: dict = Depends(get_current_user)):
    """Set/2026 · Central de documentos da obra: anexos + documentos GERADOS pelo sistema (APRs das equipes, fotos operacionais,
    requisições de almoxarifado em PDF, recebimentos) — tudo com URL para abrir/baixar."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    pid = str(project["_id"])
    aprs = []
    async for a in db.aprs.find({"project_id": pid, "user_id": current_user["_id"]}).sort("created_at", -1):
        sup = a.get("supervisor") or {}
        execs = a.get("executores") or a.get("executors") or []
        aprs.append({"id": str(a["_id"]), "date": a.get("date") or (a.get("created_at") or "")[:10], "line_type": a.get("line_type", "morta"),
                     "os_number": a.get("os_number", ""), "task": a.get("task") or a.get("tarefa", ""), "supervisor": sup.get("nome") or sup.get("name", ""),
                     "signed": bool(sup.get("assinatura")), "executors": len(execs), "created_at": a.get("created_at", ""),
                     "pdf_url": f"/api/aprs/{str(a['_id'])}/pdf"})
    reqs = []
    for r in (project.get("material_requisitions") or []):
        if r.get("is_resend"):
            continue
        rc = r.get("receipt") or {}
        reqs.append({"id": r.get("id"), "created_at": r.get("created_at", ""), "created_by": r.get("created_by", ""), "requisition_type": r.get("requisition_type", "total"),
                     "seq": r.get("seq"), "items_count": len(r.get("items") or r.get("materials_snapshot") or []), "email_status": r.get("email_status", ""),
                     "warehouse_status": (r.get("warehouse_response") or {}).get("status", ""), "received_at": rc.get("received_at", ""), "received_by": rc.get("received_by", ""),
                     "receipt_photo_url": f"/api/projects/{pid}/requisitions/{r.get('id')}/receipt-photo" if rc.get("photo_path") else "",
                     "pdf_url": f"/api/projects/{pid}/requisitions/{r.get('id')}/pdf"})
    photos = [_photo_public(pid, ph) for ph in sorted((project.get("photos") or []), key=lambda x: x.get("uploaded_at", ""), reverse=True)]
    for ph in photos:
        ph.pop("data_url_full", None)
        if (ph.get("data_url") or "").startswith("data:image") and len(ph["data_url"]) > 300000:
            ph["data_url"] = f"/api/operacional/photos/{pid}/{ph.get('id')}/file"
    atts = [a for a in (project.get("attachments") or []) if not a.get("is_deleted")]
    for a in atts:
        a["url"] = f"/api/projects/{pid}/attachments/{a.get('id')}"
    return {"project_id": pid, "attachments": atts, "aprs": aprs, "requisitions": reqs, "photos": photos,
            "materials_count": len(project.get("materials_list") or []), "returns_count": len(project.get("material_returns") or []),
            "counts": {"attachments": len(atts), "aprs": len(aprs), "requisitions": len(reqs), "photos": len(photos)}}


@api_router.get("/projects/{project_id}/requisitions/{req_id}/receipt-photo")
async def requisition_receipt_photo(project_id: str, req_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]}, {"material_requisitions": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    req = next((r for r in (project.get("material_requisitions") or []) if r.get("id") == req_id), None)
    path = ((req or {}).get("receipt") or {}).get("photo_path")
    if not path:
        raise HTTPException(status_code=404, detail="Sem foto de recebimento")
    data, ct = await storage_get(path)
    return Response(content=data, media_type=ct or "image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


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
    Smart parser: varre TODAS as abas, detecta a linha do cabeçalho procurando por
    keywords (item/descricao/quantidade/codigo) e extrai a lista mesmo quando há
    logo/cabeçalho acima. Ideal para o template Satelite.xlsx."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 10MB")
    fname = (file.filename or "").lower()

    # ORDEM É CRÍTICA: match_field itera nessa ordem e retorna no primeiro match.
    # 'code' vem ANTES de 'item' porque "COD ITEM" precisa ser classificado como code (não como item).
    # 'total_cost' vem ANTES de 'cost' porque "vlr total"/"valor total" deve prevalecer sobre "vlr"/"valor".
    # 'cost' vem ANTES de 'unit' porque "PREÇO UNIT"/"VALOR UNIT" contém "unit" mas é um custo.
    # A palavra genérica "item" NÃO é a primeira keyword de description — usamos "descric"/"descrição"
    # que são específicas e não colidem com "COD ITEM"/"item mat".
    HEADER_KEYWORDS = {
        "code": ["cod item", "cod. item", "codigo", "código", "cod.", "sap", "item mat", "code", "material code", "cod"],
        "total_cost": ["vlr total", "valor total", "total geral", "preco total", "preço total", "custo total", "total cost", "total"],
        "cost": ["preco unit", "preço unit", "valor unit", "vlr unit", "unit price", "unit cost", "preco", "preço", "custo", "cost", "price"],
        "quantity": ["quantidade", "quant.", "quant", "qtd", "qtde", "qte", "qntd", "quant orçada", "quant orcada", "qntd orçada", "qntd orcada", "quantity", "qty"],
        "unit": ["unidade", "unid.", "unid", "un", "um", "unit"],
        "item": ["descricao item", "descrição item", "descricao", "descrição", "descr", "material", "produto", "designacao", "designação", "description", "item"],
    }

    # Sheet name priority: prefer sheets that look like a requisition/material list
    def sheet_priority(name: str) -> int:
        n = str(name or "").strip().lower()
        if any(k in n for k in ["req. de material", "req material", "requisic", "requisiç", "solicitac", "solicitaç", "lista materia", "materiais"]):
            return 1000
        if "material" in n or "mrp" in n:
            return 200
        if "diario" in n or "diário" in n:
            return 50  # keep it low — usually not the primary material list
        return 0

    def norm(s):
        return str(s or "").strip().lower()

    def match_field(header_cell: str):
        h = norm(header_cell)
        if not h or h.startswith("#") or h in {"n/a", "#n/a"}:
            return None
        # Prefer specific "orçad/solicit" quantity headers first
        if any(k in h for k in ["orçad", "orcad", "solicit", "requis"]) and any(k in h for k in ["qtd", "quant", "qntd"]):
            return "quantity"
        for field, keys in HEADER_KEYWORDS.items():
            for k in keys:
                if k == h or (len(k) >= 3 and k in h):
                    return field
        return None

    def compute_field_map(header_row):
        """Map columns → fields. First column with a given field wins."""
        fields = [None] * len(header_row)
        used = set()
        for i, cell in enumerate(header_row):
            f = match_field(cell)
            if f and f not in used:
                fields[i] = f
                used.add(f)
        return fields

    def find_header_row(rows_preview):
        for idx, row in enumerate(rows_preview):
            fields = compute_field_map(row)
            if "item" in fields and "quantity" in fields:
                return idx, fields
        return -1, []

    rows: List[dict] = []
    debug = {"sheets_scanned": [], "chosen_sheet": None, "header_row": None}
    try:
        if fname.endswith(".csv") or (file.content_type or "").startswith("text/csv"):
            import csv as _csv
            text = content.decode("utf-8-sig", errors="ignore")
            delim = ";" if text.count(";") > text.count(",") else ","
            all_rows = list(_csv.reader(io.StringIO(text), delimiter=delim))
            hdr_idx, fields = find_header_row(all_rows[:30])
            if hdr_idx < 0:
                # fallback: row 0 is header
                hdr_idx, fields = 0, [match_field(c) for c in (all_rows[0] if all_rows else [])]
            for r in all_rows[hdr_idx + 1:]:
                if not any((c or "").strip() for c in r):
                    continue
                d = {}
                for i, v in enumerate(r):
                    f = fields[i] if i < len(fields) else None
                    if f:
                        d[f] = (v or "").strip()
                if d.get("item"):
                    rows.append(d)
            debug["chosen_sheet"] = "csv"
            debug["header_row"] = hdr_idx + 1
        else:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(content), data_only=True)
            best_sheet = None
            best_rows = []
            best_hdr = -1
            best_fields = []
            best_score = -1
            for ws in wb.worksheets:
                debug["sheets_scanned"].append(ws.title)
                # Read first 30 rows to detect header
                preview = []
                for r in ws.iter_rows(min_row=1, max_row=30, values_only=True):
                    preview.append([str(v) if v is not None else "" for v in r])
                hdr_idx, fields = find_header_row(preview)
                if hdr_idx < 0:
                    continue
                # Extract rows below header
                sheet_rows: List[dict] = []
                for r in ws.iter_rows(min_row=hdr_idx + 2, values_only=True):
                    if not any(v not in (None, "") for v in r):
                        continue
                    d = {}
                    for i, v in enumerate(r):
                        f = fields[i] if i < len(fields) else None
                        if f:
                            d[f] = "" if v is None else str(v).strip()
                    # Skip TOTAL/SUBTOTAL/#N/A/blank descrição rows
                    it = norm(d.get("item"))
                    if not it or it.startswith(("total", "subtotal", "soma", "#n/a", "#ref", "#value")):
                        continue
                    sheet_rows.append(d)
                # Score: sheet-name priority + item count
                score = sheet_priority(ws.title) + len(sheet_rows)
                if score > best_score and sheet_rows:
                    best_rows = sheet_rows
                    best_sheet = ws.title
                    best_hdr = hdr_idx
                    best_fields = fields
                    best_score = score
            if not best_rows:
                # Fallback to old behavior: active sheet, row 1 as header
                ws = wb.active
                headers = [norm(c.value) for c in next(ws.iter_rows(min_row=1, max_row=1))]
                for r in ws.iter_rows(min_row=2, values_only=True):
                    if not any(v not in (None, "") for v in r):
                        continue
                    d = {}
                    for i, v in enumerate(r):
                        if i < len(headers) and headers[i]:
                            d[headers[i]] = str(v).strip() if v is not None else ""
                    rows.append(d)
                debug["chosen_sheet"] = ws.title
                debug["header_row"] = 1
            else:
                rows = best_rows
                debug["chosen_sheet"] = best_sheet
                debug["header_row"] = best_hdr + 1
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao ler planilha: {e}")

    def pick(d: dict, *keys):
        # Direct mapped fields (from smart parser)
        for k in keys:
            if k in d and d[k] not in (None, ""):
                return d[k]
        # Fallback: partial-match against raw keys (legacy parser)
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
        qty = to_float(pick(r, "quantity", "quantidade", "qtd", "quant"))
        qty_out = int(qty) if qty == int(qty) else qty
        unit = pick(r, "unit", "unidade", "un", "unid")
        cost = to_float(pick(r, "cost", "preco", "valor", "custo", "preço", "vlr"))
        # Se planilha já tem VLR TOTAL, usa; senão calcula preço*qtd
        explicit_total = to_float(pick(r, "total_cost", "vlr total", "valor total"))
        total = explicit_total if explicit_total > 0 else round(cost * qty, 2)
        code = pick(r, "code", "codigo", "código", "cod")
        normalized.append({
            "id": secrets.token_urlsafe(8),
            "item": str(item),
            "code": str(code) if code else "",
            "quantity": qty_out,
            "unit": str(unit) or "un",
            "unit_cost": cost,
            "total_cost": total,
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "imported_by": current_user.get("name") or current_user.get("email") or "",
        })

    if not normalized:
        raise HTTPException(status_code=400, detail="Nenhum item válido encontrado. Verifique colunas: item/descricao, quantidade, unidade, preco.")

    await _log_material_event(project_id, {
        "type": "import", "qty": len(normalized), "by": current_user.get("name") or current_user.get("email") or "",
        "detail": f"{'Substituiu' if replace else 'Acrescentou'} {len(normalized)} item(ns) via planilha {file.filename or ''}".strip(),
    })
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

async def _log_material_event(project_id: str, event: dict):
    """Auditoria de materiais (edições manuais, avulsos, importações) → project.material_events."""
    event = {"id": secrets.token_urlsafe(6), "ts": datetime.now(timezone.utc).isoformat(), **event}
    await db.projects.update_one({"_id": safe_object_id(project_id)}, {"$push": {"material_events": event}})


@api_router.patch("/projects/{project_id}/materials/{item_id}")
async def update_material_item(
    project_id: str,
    item_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update quantity/unit/warehouse_status/code/item fields on a material item."""
    allowed = {"qty_requested", "qty_separated", "qty_written_off", "qty_delivered", "qty_applied", "notes",
               "unit", "warehouse_status", "code", "item"}
    numeric = {"qty_requested", "qty_separated", "qty_written_off", "qty_delivered", "qty_applied"}
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"], "materials_list.id": item_id},
                                         {"materials_list": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    current = next((m for m in project.get("materials_list", []) if m.get("id") == item_id), {})
    updates = {}
    changes = []
    for k, v in body.items():
        if k not in allowed:
            continue
        if k in numeric:
            try:
                new_val = float(v)
            except Exception:
                new_val = 0
            old_val = current.get(k, current.get("quantity", 0) if k == "qty_requested" else 0)
        else:
            new_val = str(v or "")
            old_val = current.get(k, "")
        updates[f"materials_list.$.{k}"] = new_val
        if str(old_val or "") != str(new_val or ""):
            changes.append((k, old_val, new_val))
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo válido")
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"], "materials_list.id": item_id},
        {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    who = current_user.get("name") or current_user.get("email") or ""
    for field, old_val, new_val in changes:
        await _log_material_event(project_id, {
            "type": "edit", "material_id": item_id, "code": current.get("code", ""), "item": current.get("item", ""), "unit": current.get("unit", "UN"),
            "field": field, "old": old_val if old_val not in (None, "") else "—", "new": new_val if new_val not in (None, "") else "—",
            "qty": new_val if field in numeric else None, "by": who,
        })
    return {"status": "updated", "id": item_id, "updates": updates}


# Fev/2026 · Reparo em massa de materiais legados (parser antigo gravava
# CÓDIGO no campo item e deixava code vazio). Aplica swap onde detecta o padrão.
import re as _re_repair
_CODE_LIKE_RE_REPAIR = _re_repair.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_./]{0,29}$")


def _material_looks_like_code(text: str) -> bool:
    if not text:
        return False
    s = str(text).strip()
    return bool(_CODE_LIKE_RE_REPAIR.match(s)) and " " not in s


@api_router.post("/projects/{project_id}/materials/repair-mapping")
async def repair_materials_mapping(project_id: str, current_user: dict = Depends(get_current_user)):
    """Repara materiais legados: se `code` vazio E `item` parece código, faz swap.
    O item.description fica vazio (não há como recuperar). Idempotente."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    materials = project.get("materials_list", []) or []
    changed = 0
    for m in materials:
        code = str(m.get("code") or "").strip()
        item = str(m.get("item") or "").strip()
        if not code and _material_looks_like_code(item):
            m["code"] = item
            m["item"] = ""
            changed += 1
    if changed:
        await db.projects.update_one(
            {"_id": safe_object_id(project_id)},
            {"$set": {"materials_list": materials}}
        )
    return {"status": "ok", "repaired": changed, "total_items": len(materials)}


@api_router.post("/projects/repair-all-materials-mapping")
async def repair_all_materials_mapping(current_user: dict = Depends(get_current_user)):
    """Reparo global do workspace atual (todas as obras do usuário)."""
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(None)
    total_changed = 0
    projects_touched = 0
    for p in projects:
        materials = p.get("materials_list", []) or []
        changed = 0
        for m in materials:
            code = str(m.get("code") or "").strip()
            item = str(m.get("item") or "").strip()
            if not code and _material_looks_like_code(item):
                m["code"] = item
                m["item"] = ""
                changed += 1
        if changed:
            await db.projects.update_one({"_id": p["_id"]}, {"$set": {"materials_list": materials}})
            total_changed += changed
            projects_touched += 1
    return {"status": "ok", "projects_touched": projects_touched, "items_repaired": total_changed}


# Fev/2026 · Adicionar item avulso (material não orçado) ao projeto
class ManualMaterialBody(BaseModel):
    item: str  # descrição
    code: str = ""
    quantity: float = 1
    unit: str = "UN"
    unit_cost: float = 0
    notes: str = ""


@api_router.post("/projects/{project_id}/materials/add-manual")
async def add_manual_material(project_id: str, body: ManualMaterialBody, current_user: dict = Depends(get_current_user)):
    """Adiciona material AVULSO (não orçado) à obra. Marcado com `source: 'avulso'`
    para diferenciar de itens importados da planilha. Total é calculado automaticamente."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    if not (body.item or "").strip():
        raise HTTPException(status_code=400, detail="Descrição do material é obrigatória")
    qty = float(body.quantity or 0)
    cost = float(body.unit_cost or 0)
    new_item = {
        "id": secrets.token_urlsafe(8),
        "item": str(body.item).strip(),
        "code": str(body.code or "").strip(),
        "quantity": int(qty) if qty == int(qty) else qty,
        "unit": (body.unit or "UN").upper(),
        "unit_cost": cost,
        "total_cost": round(cost * qty, 2),
        "notes": str(body.notes or "").strip(),
        "source": "avulso",  # marca como não orçado
        "added_at": datetime.now(timezone.utc).isoformat(),
        "added_by": current_user.get("email") or current_user.get("name") or "",
    }
    await db.projects.update_one(
        {"_id": safe_object_id(project_id)},
        {"$push": {"materials_list": new_item}}
    )
    await _log_material_event(project_id, {
        "type": "avulso", "material_id": new_item["id"], "code": new_item["code"], "item": new_item["item"], "unit": new_item["unit"],
        "qty": qty, "by": current_user.get("name") or current_user.get("email") or "", "detail": new_item["notes"] or "Material avulso (não orçado)",
    })
    return {"status": "ok", "item": new_item}


# ====== Set/2026 · Relatório de Movimentação de Materiais (linha do tempo + resumo) ======
async def _ledger_project(project_id: str, current_user: dict) -> dict:
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    return dict(project)


def _ledger_filename(project: dict, ext: str) -> str:
    code = re.sub(r"[^A-Za-z0-9_-]+", "_", str(project.get("project_code") or project.get("_id"))).strip("_")
    return f"movimentacao_materiais_{code}_{datetime.now().strftime('%Y%m%d_%H%M')}.{ext}"


@api_router.get("/projects/{project_id}/materials/ledger")
async def get_material_ledger(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _ledger_project(project_id, current_user)
    return build_material_ledger(project)


@api_router.get("/projects/{project_id}/materials/ledger/pdf")
async def get_material_ledger_pdf(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _ledger_project(project_id, current_user)
    data = await asyncio.to_thread(build_material_ledger_pdf, build_material_ledger(project))
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_ledger_filename(project, "pdf")}"'})


@api_router.get("/projects/{project_id}/materials/ledger/xlsx")
async def get_material_ledger_xlsx(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _ledger_project(project_id, current_user)
    data = await asyncio.to_thread(build_material_ledger_xlsx, build_material_ledger(project))
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{_ledger_filename(project, "xlsx")}"'})


@api_router.get("/reports/materials-consolidated")
async def get_materials_consolidated_report(
    start: Optional[str] = None,
    end: Optional[str] = None,
    team_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Excel consolidado de materiais de TODAS as obras com lista de materiais; período filtra as movimentações (posição em campo/saldo é a atual)."""
    if start and end and start[:10] > end[:10]:
        raise HTTPException(status_code=400, detail="Data inicial maior que a final")
    query = {"user_id": current_user["_id"], "materials_list.0": {"$exists": True}}
    team_label = ""
    if team_id:
        query["$or"] = [{"team_id": team_id}, {"schedule_entries.team_ids": team_id}]
        team = await db.teams.find_one({"_id": safe_object_id(team_id)})
        team_label = (team or {}).get("name", "") or team_id
    projects = await db.projects.find(query).sort("project_code", 1).to_list(5000)
    ledgers = [build_material_ledger(p) for p in projects]
    data = await asyncio.to_thread(build_consolidated_xlsx, ledgers, start or "", end or "", team_label)
    fname = f"consolidado_materiais_{(start or 'inicio')[:10]}_{(end or 'hoje')[:10]}_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Projects-Count": str(len(ledgers))})


# Fev/2026 · APR (Análise Preliminar de Risco) ==============================
class APRSignerBody(BaseModel):
    nome: str = ""
    matricula: str = ""
    assinatura: str = ""  # data URL do canvas


class APRExtraMeasure(BaseModel):
    etapa: str = ""
    risco: str = ""
    medida: str = ""


class APRBody(BaseModel):
    line_type: str = "morta"  # 'viva' | 'morta'
    os_number: str = ""
    header: dict = Field(default_factory=dict)
    epis: dict = Field(default_factory=dict)
    epcs: dict = Field(default_factory=dict)
    riscos: dict = Field(default_factory=dict)
    procedimentos: dict = Field(default_factory=dict)
    medidas_extra: List[APRExtraMeasure] = Field(default_factory=list)
    observacoes: str = ""
    supervisor: APRSignerBody = Field(default_factory=APRSignerBody)
    executores: List[APRSignerBody] = Field(default_factory=list)
    checklists: dict = Field(default_factory=dict)  # Set/2026 · {ferramental|epi|epc: {items: {k: {status: c|nc|na, obs}}, obs}}
    client_id: str = ""  # Set/2026 · id gerado offline p/ evitar duplicidade no sync


@api_router.post("/projects/{project_id}/aprs")
async def create_apr(project_id: str, body: APRBody, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    if body.client_id:
        existing = await db.aprs.find_one({"project_id": project_id, "user_id": current_user["_id"], "client_id": body.client_id})
        if existing:
            # Set/2026 · reenvio offline do mesmo client_id → atualiza em vez de duplicar
            updates = body.model_dump()
            updates["updated_at"] = datetime.now(timezone.utc).isoformat()
            await db.aprs.update_one({"_id": existing["_id"]}, {"$set": updates})
            existing = await db.aprs.find_one({"_id": existing["_id"]})
            existing["id"] = str(existing.pop("_id"))
            return existing
    doc = {
        "project_id": project_id,
        "user_id": current_user["_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("email") or current_user.get("name") or "",
        **body.model_dump(),
    }
    r = await db.aprs.insert_one(doc)
    doc["id"] = str(r.inserted_id)
    doc.pop("_id", None)
    return doc


@api_router.get("/projects/{project_id}/aprs")
async def list_project_aprs(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    out = []
    async for a in db.aprs.find({"project_id": project_id, "user_id": current_user["_id"]}).sort("created_at", -1):
        a["id"] = str(a.pop("_id"))
        out.append(a)
    return out


@api_router.get("/aprs/{apr_id}")
async def get_apr(apr_id: str, current_user: dict = Depends(get_current_user)):
    a = await db.aprs.find_one({"_id": safe_object_id(apr_id), "user_id": current_user["_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="APR não encontrada")
    a["id"] = str(a.pop("_id"))
    return a


@api_router.patch("/aprs/{apr_id}")
async def update_apr(apr_id: str, body: APRBody, current_user: dict = Depends(get_current_user)):
    a = await db.aprs.find_one({"_id": safe_object_id(apr_id), "user_id": current_user["_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="APR não encontrada")
    updates = body.model_dump()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.aprs.update_one({"_id": safe_object_id(apr_id)}, {"$set": updates})
    a2 = await db.aprs.find_one({"_id": safe_object_id(apr_id)})
    a2["id"] = str(a2.pop("_id"))
    return a2


@api_router.delete("/aprs/{apr_id}")
async def delete_apr(apr_id: str, current_user: dict = Depends(get_current_user)):
    a = await db.aprs.find_one({"_id": safe_object_id(apr_id), "user_id": current_user["_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="APR não encontrada")
    await db.aprs.delete_one({"_id": safe_object_id(apr_id)})
    return {"status": "deleted"}


@api_router.get("/aprs/{apr_id}/pdf")
async def download_apr_pdf(apr_id: str, current_user: dict = Depends(get_current_user)):
    a = await db.aprs.find_one({"_id": safe_object_id(apr_id), "user_id": current_user["_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="APR não encontrada")
    project = await db.projects.find_one({"_id": safe_object_id(a["project_id"])}) or {}
    project["id"] = str(project.get("_id", ""))
    project.pop("_id", None)
    team = None
    if project.get("team_id"):
        try:
            team = await db.teams.find_one({"_id": safe_object_id(project["team_id"])})
        except Exception:
            team = None
    from apr_pdf import build_apr_pdf
    pdf = build_apr_pdf(a, project, team)
    filename = f"APR_{a.get('os_number','') or apr_id}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============ Material template + export (Fev/2026) ============
@api_router.get("/materials/template")
async def download_material_template(current_user: dict = Depends(get_current_user)):
    """Return a standard Excel template with the columns the user expects."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    wb = Workbook()
    ws = wb.active
    ws.title = "LISTA MATERIAL"
    headers = ["COD ITEM", "DESCRIÇÃO ITEM", "QTD", "UNIDADE", "PREÇO", "VLR TOTAL"]
    yellow = PatternFill(start_color="E0FF00", end_color="E0FF00", fill_type="solid")
    border = Border(left=Side(style="thin"), right=Side(style="thin"), top=Side(style="thin"), bottom=Side(style="thin"))
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = Font(bold=True, size=11, color="000000")
        c.fill = yellow
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = border
    # Example row (linha 2) para orientação
    example = ["EX-001", "POSTE DE CONCRETO DT 10/300", 5, "UN", 850.50, 4252.50]
    for i, v in enumerate(example, 1):
        c = ws.cell(row=2, column=i, value=v)
        c.font = Font(italic=True, color="808080")
    ws.cell(row=3, column=2, value="↑ Apague esta linha de exemplo antes de reimportar. Adicione uma linha por material.").font = Font(italic=True, color="a1a1aa")
    # Column widths
    widths = [12, 45, 8, 10, 14, 14]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    ws.row_dimensions[1].height = 22
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = "modelo_lista_material_hayah.xlsx"
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/projects/{project_id}/materials/export")
async def export_project_materials(project_id: str, current_user: dict = Depends(get_current_user)):
    """Export current project.materials to Excel using the same standard template layout."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    wb = Workbook()
    ws = wb.active
    ws.title = "LISTA MATERIAL"
    headers = ["COD ITEM", "DESCRIÇÃO ITEM", "QTD", "UNIDADE", "PREÇO", "VLR TOTAL"]
    yellow = PatternFill(start_color="E0FF00", end_color="E0FF00", fill_type="solid")
    border = Border(left=Side(style="thin"), right=Side(style="thin"), top=Side(style="thin"), bottom=Side(style="thin"))
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = Font(bold=True, size=11, color="000000")
        c.fill = yellow
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = border
    materials = project.get("materials") or project.get("materials_list") or []
    row_idx = 2
    total_geral = 0.0
    for m in materials:
        qty = float(m.get("quantity") or m.get("qty_requested") or 0)
        unit_cost = float(m.get("unit_cost") or 0)
        total = float(m.get("total_cost") or (qty * unit_cost))
        total_geral += total
        ws.cell(row=row_idx, column=1, value=m.get("code") or "")
        ws.cell(row=row_idx, column=2, value=m.get("item") or "")
        ws.cell(row=row_idx, column=3, value=qty)
        ws.cell(row=row_idx, column=4, value=m.get("unit") or "un")
        ws.cell(row=row_idx, column=5, value=unit_cost)
        ws.cell(row=row_idx, column=6, value=total)
        row_idx += 1
    # Rodapé com TOTAL
    if materials:
        c = ws.cell(row=row_idx + 1, column=5, value="TOTAL GERAL:")
        c.font = Font(bold=True, size=11)
        c.alignment = Alignment(horizontal="right")
        cv = ws.cell(row=row_idx + 1, column=6, value=total_geral)
        cv.font = Font(bold=True, size=12, color="00A050")
    widths = [12, 45, 8, 10, 14, 14]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    ws.row_dimensions[1].height = 22
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    project_code = project.get("project_code") or "obra"
    filename = f"lista_material_{project_code}.xlsx"
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _requisition_balance(project: dict) -> dict:
    """Saldo por item: total da obra × já requisitado (histórico, ignora reenvios). Legado sem material_id casa por nome."""
    by_id, by_name = {}, {}
    for r in (project.get("material_requisitions") or []):
        if r.get("is_resend"):
            continue
        if r.get("requisition_type") == "parcial":
            for it in (r.get("items") or []):
                if it.get("material_id"):
                    by_id[it["material_id"]] = by_id.get(it["material_id"], 0.0) + float(it.get("qty") or 0)
            continue
        for m in (r.get("materials_snapshot") or []):
            q = float(m.get("qty_requested") or 0)
            if m.get("material_id"):
                by_id[m["material_id"]] = by_id.get(m["material_id"], 0.0) + q
            else:
                k = (m.get("item") or "").strip().lower()
                if k:
                    by_name[k] = by_name.get(k, 0.0) + q
    returned = {}
    for r in (project.get("material_returns") or []):
        for it in (r.get("items") or []):
            if it.get("material_id"):
                returned[it["material_id"]] = returned.get(it["material_id"], 0.0) + float(it.get("qty") or 0)
    items = []
    for m in (project.get("materials_list") or []):
        total = float(m.get("qty_requested", m.get("quantity", 0)) or 0)
        gross = by_id.get(m.get("id"), 0.0) + by_name.get((m.get("item") or "").strip().lower(), 0.0)
        ret = returned.get(m.get("id"), 0.0)
        done = max(0.0, gross - ret)
        items.append({"id": m.get("id"), "qty_total": total, "qty_requisitioned": round(gross, 3), "qty_returned": round(ret, 3),
                      "net_requisitioned": round(done, 3),
                      "saldo": round(max(0.0, total - done), 3), "over": round(max(0.0, done - total), 3)})
    partials = [r for r in (project.get("material_requisitions") or []) if r.get("requisition_type") == "parcial" and not r.get("is_resend")]
    return {
        "items": items, "partial_count": len(partials), "next_seq": len(partials) + 1,
        "return_count": len(project.get("material_returns") or []),
        "returned_qty": round(sum(i["qty_returned"] for i in items), 3),
        "fully_requisitioned": bool(items) and all(i["saldo"] <= 0 for i in items),
        "total_qty": round(sum(i["qty_total"] for i in items), 3),
        "requisitioned_qty": round(sum(min(i["net_requisitioned"], i["qty_total"]) for i in items), 3),
    }


def _partial_selection(project: dict, requisition_type: str, items_json: str):
    """Requisição parcial: [{id, qty}] → (itens com req_qty/req_done/req_saldo, info da remessa). Total → (None, None)."""
    if (requisition_type or "total") != "parcial":
        return None, None
    try:
        raw = json.loads(items_json or "[]")
    except Exception:
        raise HTTPException(status_code=400, detail="Itens da requisição parcial inválidos")
    wanted = {str(x.get("id")): float(x.get("qty") or 0) for x in raw if isinstance(x, dict) and x.get("id")}
    wanted = {k: v for k, v in wanted.items() if v > 0}
    if not wanted:
        raise HTTPException(status_code=400, detail="Selecione ao menos um item com quantidade maior que zero")
    bal = _requisition_balance(project)
    by_id = {b["id"]: b for b in bal["items"]}
    sel = []
    for m in (project.get("materials_list") or []):
        if m.get("id") in wanted:
            b = by_id.get(m["id"], {})
            sel.append({**m, "req_qty": wanted[m["id"]], "req_done": b.get("net_requisitioned", 0.0), "req_saldo": b.get("saldo", 0.0)})
    if not sel:
        raise HTTPException(status_code=400, detail="Nenhum item selecionado existe na lista da obra")
    partial = {"seq": bal["next_seq"], "selected": len(sel), "total_items": len(project.get("materials_list") or [])}
    return sel, partial


def _req_rebuild_args(req: dict):
    """Reconstrói (itens, info parcial) de uma requisição salva para regerar o PDF."""
    if req.get("requisition_type") != "parcial":
        return None, None
    sel = [{"id": it.get("material_id"), "code": it.get("code", ""), "item": it.get("item", ""), "unit": it.get("unit", "un"),
            "qty_requested": it.get("qty_total", 0), "req_qty": it.get("qty", 0), "req_done": it.get("qty_done_before", 0)}
           for it in (req.get("items") or [])]
    return sel, {"seq": req.get("seq") or 1, "selected": len(sel), "total_items": len(req.get("materials_snapshot") or sel)}


@api_router.get("/projects/{project_id}/materials/requisition-balance")
async def get_requisition_balance(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    return _requisition_balance(project)


# ====== Set/2026 · Devolução de sobras (material que voltou do campo → saldo da obra) ======
class MaterialReturnItem(BaseModel):
    material_id: str
    qty: float = 0.0


class MaterialReturnBody(BaseModel):
    date: str = ""
    returned_by: str = ""
    reason: str = ""
    notes: str = ""
    items: List[MaterialReturnItem] = []


@api_router.post("/projects/{project_id}/materials/returns")
async def add_material_return(project_id: str, body: MaterialReturnBody, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    bal = {b["id"]: b for b in _requisition_balance(project)["items"]}
    mats = {m.get("id"): m for m in (project.get("materials_list") or [])}
    items = []
    for it in body.items:
        if it.qty <= 0:
            continue
        m = mats.get(it.material_id)
        if not m:
            raise HTTPException(status_code=400, detail="Item não encontrado na lista da obra")
        in_field = float(bal.get(it.material_id, {}).get("net_requisitioned", 0.0))
        if it.qty > in_field + 1e-9:
            raise HTTPException(status_code=400, detail=f"Devolução de '{m.get('item','')}' ({it.qty:g}) maior que o requisitado em campo ({in_field:g})")
        items.append({"material_id": it.material_id, "code": m.get("code", ""), "item": m.get("item", ""), "unit": m.get("unit", "un"), "qty": float(it.qty)})
    if not items:
        raise HTTPException(status_code=400, detail="Informe ao menos um item com quantidade devolvida")
    entry = {
        "id": secrets.token_urlsafe(8), "created_at": datetime.now(timezone.utc).isoformat(),
        "date": (body.date or _today_cuiaba())[:10], "registered_by": current_user.get("name", "") or current_user.get("email", ""),
        "returned_by": body.returned_by.strip(), "reason": body.reason.strip(), "notes": body.notes.strip(), "items": items,
        "total_qty": round(sum(i["qty"] for i in items), 3),
    }
    await db.projects.update_one({"_id": project["_id"]}, {"$push": {"material_returns": entry}})
    project["material_returns"] = (project.get("material_returns") or []) + [entry]
    return {"status": "ok", "return": entry, "balance": _requisition_balance(project)}


@api_router.delete("/projects/{project_id}/materials/returns/{return_id}")
async def delete_material_return(project_id: str, return_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"]},
        {"$pull": {"material_returns": {"id": return_id}}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    return {"status": "deleted"}


# ====== Set/2026 · Baixa por remessa (separado/entregue por requisição) ======
def _req_items_normalized(project: dict, req: dict) -> list:
    """Itens de uma remessa (parcial → items[]; total → snapshot, legado casa por nome) + baixa já registrada."""
    mats = project.get("materials_list") or []
    by_id = {m.get("id"): m for m in mats}
    by_name = {(m.get("item") or "").strip().lower(): m for m in mats}
    if req.get("requisition_type") == "parcial":
        src = [{"material_id": it.get("material_id"), "qty": it.get("qty"), "item": it.get("item"), "unit": it.get("unit")} for it in (req.get("items") or [])]
    else:
        src = []
        for s in (req.get("materials_snapshot") or []):
            mid = s.get("material_id") or (by_name.get((s.get("item") or "").strip().lower()) or {}).get("id")
            src.append({"material_id": mid, "qty": s.get("qty_requested"), "item": s.get("item"), "unit": s.get("unit")})
    ful = {f.get("material_id"): f for f in ((req.get("fulfillment") or {}).get("items") or [])}
    out = []
    for s in src:
        if not s.get("material_id"):
            continue
        m = by_id.get(s["material_id"]) or {}
        f = ful.get(s["material_id"], {})
        out.append({"material_id": s["material_id"], "code": m.get("code", ""), "item": m.get("item") or s.get("item") or "",
                    "unit": (m.get("unit") or s.get("unit") or "un"), "qty": float(s.get("qty") or 0),
                    "qty_separated": float(f.get("qty_separated") or 0), "qty_delivered": float(f.get("qty_delivered") or 0)})
    return out


class FulfillmentItem(BaseModel):
    material_id: str
    qty_separated: float = 0.0
    qty_delivered: float = 0.0


class FulfillmentBody(BaseModel):
    responsible: str = ""
    notes: str = ""
    items: List[FulfillmentItem] = []


@api_router.get("/projects/{project_id}/requisitions/{req_id}/items")
async def get_requisition_items(project_id: str, req_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    req = next((r for r in (project.get("material_requisitions") or []) if r.get("id") == req_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Requisição não encontrada")
    return {"items": _req_items_normalized(project, req), "fulfillment": req.get("fulfillment")}


@api_router.post("/projects/{project_id}/requisitions/{req_id}/fulfillment")
async def set_requisition_fulfillment(project_id: str, req_id: str, body: FulfillmentBody, current_user: dict = Depends(get_current_user)):
    """Registra separado/entregue desta remessa e recalcula os totais da obra (soma das remessas) para os itens tocados."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Obra não encontrada")
    req = next((r for r in (project.get("material_requisitions") or []) if r.get("id") == req_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Requisição não encontrada")
    if req.get("is_resend"):
        raise HTTPException(status_code=400, detail="Registre a baixa na requisição original, não no reenvio")
    valid = {it["material_id"] for it in _req_items_normalized(project, req)}
    items = [{"material_id": i.material_id, "qty_separated": max(0.0, float(i.qty_separated or 0)), "qty_delivered": max(0.0, float(i.qty_delivered or 0))}
             for i in body.items if i.material_id in valid]
    if not items:
        raise HTTPException(status_code=400, detail="Nenhum item válido desta remessa")
    fulfillment = {"updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user.get("name", "") or current_user.get("email", ""),
                   "responsible": body.responsible.strip(), "notes": body.notes.strip(), "items": items}
    await db.projects.update_one({"_id": project["_id"], "material_requisitions.id": req_id}, {"$set": {"material_requisitions.$.fulfillment": fulfillment}})
    project = await db.projects.find_one({"_id": project["_id"]})
    sums = {}
    for r in (project.get("material_requisitions") or []):
        if r.get("is_resend"):
            continue
        for f in ((r.get("fulfillment") or {}).get("items") or []):
            s = sums.setdefault(f.get("material_id"), [0.0, 0.0])
            s[0] += float(f.get("qty_separated") or 0)
            s[1] += float(f.get("qty_delivered") or 0)
    for mid, (sep, ent) in sums.items():
        await db.projects.update_one({"_id": project["_id"], "materials_list.id": mid},
                                     {"$set": {"materials_list.$.qty_separated": round(sep, 3), "materials_list.$.qty_delivered": round(ent, 3)}})
    return {"status": "ok", "fulfillment": fulfillment, "totals_updated": len(sums)}


@api_router.post("/materials/preview")
async def preview_material_requisition(
    current_user: dict = Depends(get_current_user),
    project_id: str = Form(...),
    notes: str = Form(""),
    signature_name: str = Form(""),
    requisition_type: str = Form("total"),
    items: str = Form(""),
):
    """Generate the requisition PDF WITHOUT sending it. Returns application/pdf inline so the frontend
    can render it in an iframe/preview modal. No history entry is created, no email is sent."""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    preview_id = "PREVIEW-" + secrets.token_urlsafe(6)
    sel, partial = _partial_selection(project, requisition_type, items)
    try:
        pdf_bytes = await asyncio.to_thread(
            build_requisition_pdf,
            project,
            signature_name,
            notes,
            preview_id,
            current_user.get("name", ""),
            sel,
            partial,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF: {e}")
    filename = f"previa_requisicao_{project.get('project_code','') or 'obra'}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@api_router.post("/materials/request")
async def request_materials(
    current_user: dict = Depends(get_current_user),
    project_id: str = Form(...),
    notes: str = Form(""),
    signature_name: str = Form(""),
    requisition_type: str = Form("total"),
    items: str = Form(""),
    material_pdf: Optional[UploadFile] = File(None),
    project_pdf: Optional[UploadFile] = File(None),
):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    sel, partial = _partial_selection(project, requisition_type, items)
    
    recipients = await _warehouse_emails(db)
    
    if not recipients:
        raise HTTPException(status_code=400, detail="Nenhum destinatário configurado — informe o e-mail do almoxarifado em Configurações › Integrações")
    
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
    
    # Build material list HTML from project.materials_list (ou só os itens da remessa parcial)
    all_materials = project.get("materials_list", []) or []
    materials = sel if partial else all_materials
    materials_rows = ""
    total_solicitado = 0
    total_separado = 0
    total_baixado = 0
    total_entregue = 0
    if partial:
        for m in materials:
            qt = float(m.get("qty_requested", m.get("quantity", 0)) or 0)
            done = float(m.get("req_done") or 0)
            now = float(m.get("req_qty") or 0)
            saldo = max(0.0, qt - done - now)
            total_solicitado += now
            materials_rows += f"""
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">{m.get('code','') or ''} {m.get('item','')}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:center;">{m.get('unit','un')}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;">{qt:g}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;color:#888;">{done:g}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;font-weight:bold;color:#E55400;">{now:g}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align:right;color:#005EE0;">{saldo:g}</td>
        </tr>"""
    for m in ([] if partial else materials):
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

    if partial:
        materials_table = f"""
    <div style="margin-top:20px;padding:10px 14px;background:#FF5E00;color:#050505;font-weight:bold;border-radius:6px;">
      REQUISIÇÃO PARCIAL nº {partial['seq']} · {partial['selected']} de {partial['total_items']} itens · a equipe levará apenas as quantidades abaixo
    </div>
    <h3 style="color:#00F0FF;margin-top:16px;margin-bottom:8px;">Itens desta remessa ({len(materials)})</h3>
    <table width="100%" style="border-collapse:collapse;background:#fff;color:#050505;font-size:12px;border:1px solid #ddd;">
      <thead>
        <tr style="background:#050505;color:#E0FF00;">
          <th style="padding:6px 8px;text-align:left;">Item</th>
          <th style="padding:6px 8px;">Un</th>
          <th style="padding:6px 8px;text-align:right;">Qtd. Obra</th>
          <th style="padding:6px 8px;text-align:right;">Já Req.</th>
          <th style="padding:6px 8px;text-align:right;">Nesta Req.</th>
          <th style="padding:6px 8px;text-align:right;">Saldo</th>
        </tr>
      </thead>
      <tbody>{materials_rows}</tbody>
      <tfoot>
        <tr style="background:#f5f5f5;font-weight:bold;">
          <td colspan="4" style="padding:6px 8px;text-align:right;">TOTAL NESTA REMESSA</td>
          <td style="padding:6px 8px;text-align:right;color:#E55400;">{total_solicitado:g}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    """
    else:
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
        <h2 style="color: #00F0FF; margin-top: 0;">{'Solicitação PARCIAL de Material nº ' + str(partial['seq']) if partial else 'Solicitação de Material'}</h2>
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
    subject = f"[HAYAH{' · PARCIAL ' + str(partial['seq']) if partial else ''}] Solicitação de Material · {project.get('project_code','') or ''} · {project.get('name','')}"

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
            sel,
            partial,
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
        "requisition_type": "parcial" if partial else "total",
        "seq": partial["seq"] if partial else None,
        "items": [
            {
                "material_id": m.get("id"), "code": m.get("code", ""), "item": m.get("item", ""), "unit": m.get("unit", "un"),
                "qty": float(m.get("req_qty") or 0), "qty_total": float(m.get("qty_requested", m.get("quantity", 0)) or 0),
                "qty_done_before": float(m.get("req_done") or 0),
                "saldo_after": round(max(0.0, float(m.get("qty_requested", m.get("quantity", 0)) or 0) - float(m.get("req_done") or 0) - float(m.get("req_qty") or 0)), 3),
            }
            for m in sel
        ] if partial else [],
        "materials_snapshot": [
            {
                "material_id": m.get("id"),
                "item": m.get("item", ""),
                "unit": m.get("unit", "un"),
                "qty_requested": (m.get("req_qty") if partial else m.get("qty_requested", m.get("quantity", 0))),
                "qty_separated": m.get("qty_separated", 0),
                "qty_written_off": m.get("qty_written_off", 0),
                "qty_delivered": m.get("qty_delivered", 0),
            }
            for m in materials
        ],
        "receipt": None,  # filled by confirm-receipt endpoint
    }

    # ====== Send via Resend ======
    api_key, sender = await _resend_credentials(db)
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
    sel, partial = _req_rebuild_args(req)
    data = await asyncio.to_thread(
        build_requisition_pdf,
        project, req.get("signature_name", ""), req.get("notes", ""),
        req_id, req.get("created_by", ""), sel, partial,
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
        sel, partial = _req_rebuild_args(original)
        pdf_bytes = await asyncio.to_thread(
            build_requisition_pdf,
            project, original.get("signature_name", ""), original.get("notes", ""),
            req_id, original.get("created_by", ""), sel, partial,
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
        "requisition_type": original.get("requisition_type", "total"),
        "seq": original.get("seq"),
        "items": original.get("items") or [],
    }

    api_key, sender = await _resend_credentials(db)
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


# =============================================================================
# ESTOQUE (Almoxarifado físico) — Fev/2026 Onda 2
# =============================================================================

class StockItemBase(BaseModel):
    code: str
    description: str
    unit: str = "UN"
    family: str = ""
    group: str = ""
    qty_system: float = 0.0
    qty_physical: float = 0.0
    unit_value: float = 0.0
    min_stock: float = 0.0
    notes: str = ""


class StockItemCreate(StockItemBase):
    pass


class StockItemUpdate(BaseModel):
    code: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    family: Optional[str] = None
    group: Optional[str] = None
    qty_system: Optional[float] = None
    qty_physical: Optional[float] = None
    unit_value: Optional[float] = None
    min_stock: Optional[float] = None
    notes: Optional[str] = None


def _stock_doc_to_dict(doc: dict) -> dict:
    """Serialize stock item (adds computed fields net/accuracy/value_*)."""
    qs = float(doc.get("qty_system") or 0)
    qp = float(doc.get("qty_physical") or 0)
    uv = float(doc.get("unit_value") or 0)
    net = qp - qs
    # accuracy: 1 - |net| / max(qs, qp, 1) — bounded 0..1
    denom = max(qs, qp, 1.0)
    accuracy = max(0.0, min(1.0, 1.0 - abs(net) / denom))
    ms = float(doc.get("min_stock") or 0)
    return {
        "id": str(doc["_id"]),
        "code": doc.get("code", ""),
        "description": doc.get("description", ""),
        "unit": (doc.get("unit") or "UN").upper(),
        "family": doc.get("family", ""),
        "group": doc.get("group", ""),
        "qty_system": qs,
        "qty_physical": qp,
        "unit_value": uv,
        "min_stock": ms,
        "notes": doc.get("notes", ""),
        "net": round(net, 4),
        "accuracy": round(accuracy, 4),
        "value_physical": round(qp * uv, 2),
        "value_system": round(qs * uv, 2),
        "value_diff": round((qp - qs) * uv, 2),
        "is_low_stock": ms > 0 and qp <= ms,
        "is_divergent": abs(net) > 0.001,
        "last_updated_at": doc.get("last_updated_at", ""),
        "last_imported_at": doc.get("last_imported_at", ""),
        "created_at": doc.get("created_at", ""),
    }


@api_router.get("/estoque")
async def list_stock_items(
    q: Optional[str] = None,
    family: Optional[str] = None,
    group: Optional[str] = None,
    low_stock: Optional[bool] = None,
    divergent: Optional[bool] = None,
    limit: int = 5000,
    current_user: dict = Depends(get_current_user),
):
    """Lista os itens de estoque do usuário. Filtros: q, family, group, low_stock, divergent."""
    mongo_q: dict = {"user_id": current_user["_id"]}
    if q:
        # busca por código OU descrição (case-insensitive)
        import re as _re
        rx = _re.compile(_re.escape(q), _re.IGNORECASE)
        mongo_q["$or"] = [{"code": rx}, {"description": rx}]
    if family:
        mongo_q["family"] = family
    if group:
        mongo_q["group"] = group
    docs = await db.stock_items.find(mongo_q).sort("code", 1).to_list(limit)
    items = [_stock_doc_to_dict(d) for d in docs]
    if low_stock:
        items = [i for i in items if i["is_low_stock"]]
    if divergent:
        items = [i for i in items if i["is_divergent"]]
    return {"items": items, "count": len(items)}


@api_router.get("/estoque/kpis")
async def stock_kpis(current_user: dict = Depends(get_current_user)):
    docs = await db.stock_items.find({"user_id": current_user["_id"]}).to_list(20000)
    total_items = len(docs)
    if not docs:
        return {
            "total_items": 0,
            "value_physical_total": 0.0,
            "value_system_total": 0.0,
            "value_diff_total": 0.0,
            "accuracy_global": 0.0,
            "low_stock_count": 0,
            "divergent_count": 0,
            "families_count": 0,
            "groups_count": 0,
        }
    value_phys = 0.0
    value_sys = 0.0
    acc_sum = 0.0
    low_count = 0
    div_count = 0
    families: set = set()
    groups: set = set()
    for d in docs:
        it = _stock_doc_to_dict(d)
        value_phys += it["value_physical"]
        value_sys += it["value_system"]
        acc_sum += it["accuracy"]
        if it["is_low_stock"]:
            low_count += 1
        if it["is_divergent"]:
            div_count += 1
        if it["family"]:
            families.add(it["family"])
        if it["group"]:
            groups.add(it["group"])
    return {
        "total_items": total_items,
        "value_physical_total": round(value_phys, 2),
        "value_system_total": round(value_sys, 2),
        "value_diff_total": round(value_phys - value_sys, 2),
        "accuracy_global": round(acc_sum / total_items, 4),
        "low_stock_count": low_count,
        "divergent_count": div_count,
        "families_count": len(families),
        "groups_count": len(groups),
    }


@api_router.get("/estoque/families")
async def stock_families(current_user: dict = Depends(get_current_user)):
    """Retorna listas únicas de famílias e grupos para os filtros."""
    docs = await db.stock_items.find({"user_id": current_user["_id"]}, {"family": 1, "group": 1}).to_list(20000)
    families = sorted({(d.get("family") or "").strip() for d in docs if (d.get("family") or "").strip()})
    groups = sorted({(d.get("group") or "").strip() for d in docs if (d.get("group") or "").strip()})
    return {"families": families, "groups": groups}


@api_router.post("/estoque")
async def create_stock_item(body: StockItemCreate, current_user: dict = Depends(get_current_user)):
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Código obrigatório")
    existing = await db.stock_items.find_one({"user_id": current_user["_id"], "code": code})
    if existing:
        raise HTTPException(status_code=409, detail=f"Já existe item com código {code}")
    now = datetime.now(timezone.utc).isoformat()
    doc = {**body.model_dump(), "user_id": current_user["_id"], "created_at": now, "last_updated_at": now}
    doc["code"] = code
    doc["unit"] = (doc.get("unit") or "UN").upper()
    res = await db.stock_items.insert_one(doc)
    saved = await db.stock_items.find_one({"_id": res.inserted_id})
    return _stock_doc_to_dict(saved)


@api_router.patch("/estoque/{item_id}")
async def update_stock_item(item_id: str, body: StockItemUpdate, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Nada para atualizar")
    if "unit" in updates:
        updates["unit"] = (updates["unit"] or "UN").upper()
    if "code" in updates:
        updates["code"] = (updates["code"] or "").strip()
        # ensure no duplicate
        clash = await db.stock_items.find_one({"user_id": current_user["_id"], "code": updates["code"], "_id": {"$ne": safe_object_id(item_id)}})
        if clash:
            raise HTTPException(status_code=409, detail=f"Outro item já usa o código {updates['code']}")
    updates["last_updated_at"] = datetime.now(timezone.utc).isoformat()
    before = await db.stock_items.find_one({"_id": safe_object_id(item_id), "user_id": current_user["_id"]})
    r = await db.stock_items.update_one(
        {"_id": safe_object_id(item_id), "user_id": current_user["_id"]},
        {"$set": updates},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    doc = await db.stock_items.find_one({"_id": safe_object_id(item_id)})
    out = _stock_doc_to_dict(doc)
    if out["is_low_stock"] and not (before and _stock_doc_to_dict(before)["is_low_stock"]):
        asyncio.create_task(_stock_instant_alert(db, current_user["_id"], [out], os.environ.get("FRONTEND_URL", "")))
    return out


@api_router.delete("/estoque/{item_id}")
async def delete_stock_item(item_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.stock_items.delete_one({"_id": safe_object_id(item_id), "user_id": current_user["_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    return {"status": "deleted"}


@api_router.post("/estoque/import")
async def import_stock_sistemico(
    file: UploadFile = File(...),
    mode: str = Form("merge"),  # merge (default) | replace_system_only
    current_user: dict = Depends(get_current_user),
):
    """Importa planilha SISTÊMICA (xlsx/csv) e atualiza qty_system + description/unit.
    Colunas aceitas: código/COD, descrição, unidade/UNID, quantidade sistêmica (SOMA/QTD).
    Modo 'merge': cria itens novos e atualiza campos sistêmicos dos existentes (mantém qty_physical).
    Modo 'replace_system_only': zera qty_system dos itens NÃO presentes na planilha.
    """
    import openpyxl, csv as _csv, io as _io

    fname = (file.filename or "").lower()
    raw = await file.read()
    if len(raw) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo > 30MB")
    _low_before = {str(d["_id"]) for d in await db.stock_items.find({"user_id": current_user["_id"], "min_stock": {"$gt": 0}}).to_list(20000) if _stock_doc_to_dict(d)["is_low_stock"]}

    rows: List[dict] = []
    header_norm = lambda s: (str(s or "").strip().lower().replace("ç", "c").replace("ã", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u"))

    def _pick_col(headers, keywords):
        for i, h in enumerate(headers):
            nh = header_norm(h)
            for kw in keywords:
                if kw in nh:
                    return i
        return -1

    if fname.endswith(".csv"):
        text = raw.decode("utf-8-sig", errors="ignore")
        reader = _csv.reader(_io.StringIO(text))
        all_rows = list(reader)
        if not all_rows:
            raise HTTPException(status_code=400, detail="CSV vazio")
        headers = all_rows[0]
        for r in all_rows[1:]:
            row = {headers[i]: r[i] if i < len(r) else "" for i in range(len(headers))}
            rows.append(row)
        header_list = headers
    else:
        try:
            wb = openpyxl.load_workbook(_io.BytesIO(raw), read_only=True, data_only=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Arquivo Excel inválido: {e}")
        # Escolhe a MELHOR aba (procura por cabeçalho contendo COD/DESCRIÇÃO/UNID em qq linha das primeiras 10)
        best_ws = None
        best_header_row = 0
        best_headers: List[str] = []
        for name in wb.sheetnames:
            ws = wb[name]
            for i, row in enumerate(ws.iter_rows(min_row=1, max_row=15, values_only=True), start=1):
                vals = [str(c) if c is not None else "" for c in row]
                joined = " ".join(vals).lower()
                if ("cod" in joined and "descric" in joined) or ("código" in joined and "descrição" in joined) or ("cod" in joined and "unid" in joined):
                    best_ws = ws
                    best_header_row = i
                    best_headers = vals
                    break
            if best_ws:
                break
        if not best_ws:
            raise HTTPException(status_code=400, detail="Não encontrei colunas COD/DESCRIÇÃO/UNID na planilha")
        for r in best_ws.iter_rows(min_row=best_header_row + 1, values_only=True):
            row = {best_headers[i]: r[i] if i < len(r) else "" for i in range(len(best_headers))}
            rows.append(row)
        header_list = best_headers

    # Identifica colunas dentro dos headers.
    # ATENÇÃO: para "description" NÃO usar 'material' — colide com "SITUAÇÃO MATERIAL".
    ci_code = _pick_col(header_list, ["cod"])
    ci_desc = _pick_col(header_list, ["descric", "descricao"])
    ci_unit = _pick_col(header_list, ["unid", "unit"])
    ci_qty = _pick_col(header_list, ["soma", "qtd sistema", "qtde sistema", "qtd_sistema", "qty_system", "estoque sistema", "quantidade sistema"])
    ci_family = _pick_col(header_list, ["familia", "family"])
    ci_group = _pick_col(header_list, ["grupo", "group"])
    ci_situacao = _pick_col(header_list, ["situacao", "situação", "status"])

    if ci_code < 0 or ci_desc < 0:
        raise HTTPException(status_code=400, detail="Cabeçalhos COD/DESCRIÇÃO obrigatórios")

    def _to_float(v):
        try:
            if v is None or v == "":
                return 0.0
            if isinstance(v, (int, float)):
                return float(v)
            s = str(v).strip().replace(".", "").replace(",", ".")
            # if the value already had a real decimal, above corrupts it; try both
            try:
                return float(s)
            except Exception:
                return float(str(v).replace(",", "."))
        except Exception:
            return 0.0

    imported = 0
    updated = 0
    created = 0
    seen_codes: set = set()
    now = datetime.now(timezone.utc).isoformat()
    header_list_arr = list(header_list)

    for r in rows:
        vals = [r.get(header_list_arr[i], "") if i < len(header_list_arr) else "" for i in range(len(header_list_arr))]
        code = str(vals[ci_code] or "").strip()
        desc = str(vals[ci_desc] or "").strip()
        if not code or not desc:
            continue
        unit = (str(vals[ci_unit] or "UN").strip() if ci_unit >= 0 else "UN").upper()
        qty_sys = _to_float(vals[ci_qty]) if ci_qty >= 0 else 0.0
        family = str(vals[ci_family] or "").strip() if ci_family >= 0 else ""
        group = str(vals[ci_group] or "").strip() if ci_group >= 0 else ""
        situacao = str(vals[ci_situacao] or "").strip() if ci_situacao >= 0 else ""
        seen_codes.add(code)
        existing = await db.stock_items.find_one({"user_id": current_user["_id"], "code": code})
        set_doc = {
            "description": desc,
            "unit": unit,
            "qty_system": qty_sys,
            "last_imported_at": now,
            "last_updated_at": now,
        }
        if family:
            set_doc["family"] = family
        if group:
            set_doc["group"] = group
        if situacao:
            set_doc["situacao"] = situacao
        if existing:
            await db.stock_items.update_one({"_id": existing["_id"]}, {"$set": set_doc})
            updated += 1
        else:
            doc = {
                "user_id": current_user["_id"],
                "code": code,
                "description": desc,
                "unit": unit,
                "qty_system": qty_sys,
                "qty_physical": 0.0,
                "unit_value": 0.0,
                "min_stock": 0.0,
                "family": family,
                "group": group,
                "situacao": situacao,
                "notes": "",
                "created_at": now,
                "last_imported_at": now,
                "last_updated_at": now,
            }
            await db.stock_items.insert_one(doc)
            created += 1
        imported += 1

    zeroed = 0
    if mode == "replace_system_only" and seen_codes:
        r = await db.stock_items.update_many(
            {"user_id": current_user["_id"], "code": {"$nin": list(seen_codes)}},
            {"$set": {"qty_system": 0.0, "last_updated_at": now}},
        )
        zeroed = r.modified_count

    _newly_low = [_stock_doc_to_dict(d) for d in await db.stock_items.find({"user_id": current_user["_id"], "min_stock": {"$gt": 0}}).to_list(20000)]
    _newly_low = [i for i in _newly_low if i["is_low_stock"] and i["id"] not in _low_before]
    if _newly_low:
        asyncio.create_task(_stock_instant_alert(db, current_user["_id"], _newly_low, os.environ.get("FRONTEND_URL", "")))

    return {
        "imported": imported,
        "created": created,
        "updated": updated,
        "zeroed_when_absent": zeroed,
        "mode": mode,
        "newly_low_stock": len(_newly_low),
    }


@api_router.get("/estoque/export")
async def export_stock_csv(current_user: dict = Depends(get_current_user)):
    """Exporta o estoque atual como CSV."""
    docs = await db.stock_items.find({"user_id": current_user["_id"]}).sort("code", 1).to_list(20000)
    import csv as _csv, io as _io
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["codigo", "descricao", "unidade", "familia", "grupo", "qty_sistema", "qty_fisica", "net", "valor_unit", "valor_fisico", "valor_sistemico", "min_stock", "notas"])
    for d in docs:
        it = _stock_doc_to_dict(d)
        w.writerow([
            it["code"], it["description"], it["unit"], it["family"], it["group"],
            it["qty_system"], it["qty_physical"], it["net"],
            it["unit_value"], it["value_physical"], it["value_system"], it["min_stock"],
            it["notes"],
        ])
    csv_bytes = buf.getvalue().encode("utf-8-sig")
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="estoque-{datetime.now(timezone.utc).strftime("%Y%m%d")}.csv"'},
    )


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

from avanco_fisico import build_router as _build_avanco_router
def _today_cuiaba():
    try:
        return datetime.now(ZoneInfo("America/Cuiaba")).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")
app.include_router(_build_avanco_router(db, get_current_user, require_admin, safe_object_id, _today_cuiaba, storage_get, requisition_balance=_requisition_balance))

from orcamentos import build_router as _build_orcamentos_router
app.include_router(_build_orcamentos_router(db, get_current_user, safe_object_id, storage_put, storage_get, APP_NAME, _today_cuiaba))
app.include_router(_build_notifications_router(db, get_current_user, os.environ.get("FRONTEND_URL", "")))
from laudo_trafo import build_router as _build_laudo_router
app.include_router(_build_laudo_router(db, get_current_user, safe_object_id, storage_put, storage_get, APP_NAME, _apply_photo_watermark))
app.include_router(_campo.build_router(db, get_current_user, safe_object_id, build_project_response, _photo_public))
import sucata as _sucata
app.include_router(_sucata.build_router(db, get_current_user, safe_object_id))
app.include_router(_pdf_jobs.build_router(get_current_user))
import medicao as _medicao
app.include_router(_medicao.build_router(db, get_current_user, safe_object_id, build_project_response))


async def notifications_tick_job():
    await _notifications_tick(db, os.environ.get("FRONTEND_URL", ""))

_cors_env = os.environ.get('CORS_ORIGINS', '').strip()
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'] if _cors_env == '*' else ([o.strip() for o in _cors_env.split(',') if o.strip()] or [os.environ.get('FRONTEND_URL', 'http://localhost:3000')]),
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
    # Backfill idempotente (Set/2026): obra programada no calendário sem status → "programado"
    try:
        r = await db.projects.update_many(
            {"is_scheduled": True, "execution_status": {"$in": [None, "", "aguardando_programacao"]},
             "$or": [{"schedule_entries.0": {"$exists": True}}, {"start_date": {"$nin": [None, ""]}}]},
            {"$set": {"execution_status": "programado"}},
        )
        if r.modified_count:
            logger.info(f"Backfill execution_status=programado: {r.modified_count} obra(s)")
    except Exception as e:
        logger.warning(f"backfill programado: {e}")
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
            "session_version": 0,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Admin user created: {admin_email}")
    else:
        # Ensure admin has full perms + approved
        updates = {}
        if existing.get("status") != "approved": updates["status"] = "approved"
        if not existing.get("permissions"): updates["permissions"] = ALL_PERMISSIONS
        if existing.get("role") != "admin": updates["role"] = "admin"
        if not verify_password(admin_password, existing["password_hash"]):
            updates["password_hash"] = hash_password(admin_password)
        if "session_version" not in existing:
            updates["session_version"] = 0
        if updates:
            await db.users.update_one({"email": admin_email}, {"$set": updates})
            logger.info("Admin ensured approved + full permissions")

    # Sandbox testing admin (used by the automated testing agent)
    sandbox_email = "admin@projectmatrix.com"
    sandbox_password = "Admin@123"
    sandbox_existing = await db.users.find_one({"email": sandbox_email})
    if sandbox_existing is None:
        await db.users.insert_one({
            "email": sandbox_email, "password_hash": hash_password(sandbox_password), "name": "Testing Admin",
            "role": "admin", "status": "approved", "permissions": ALL_PERMISSIONS,
            "session_version": 0,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info(f"Sandbox admin created: {sandbox_email}")
    else:
        s_updates = {}
        if sandbox_existing.get("role") != "admin": s_updates["role"] = "admin"
        if sandbox_existing.get("status") != "approved": s_updates["status"] = "approved"
        if not sandbox_existing.get("permissions"): s_updates["permissions"] = ALL_PERMISSIONS
        if not verify_password(sandbox_password, sandbox_existing["password_hash"]):
            s_updates["password_hash"] = hash_password(sandbox_password)
        if "session_version" not in sandbox_existing:
            s_updates["session_version"] = 0
        if s_updates:
            await db.users.update_one({"email": sandbox_email}, {"$set": s_updates})

    # Backfill session_version=0 on all users missing the field (idempotent migration)
    try:
        await db.users.update_many({"session_version": {"$exists": False}}, {"$set": {"session_version": 0}})
    except Exception as e:
        logger.warning(f"session_version backfill: {e}")

    # Backfill owner_id for regular users so they share the primary admin's workspace.
    # Rule: role == 'user' and owner_id missing → set owner_id = primary admin _id (from ADMIN_EMAIL).
    # Admin users own their own workspace (owner_id stays null).
    try:
        primary = await db.users.find_one({"email": admin_email})
        if primary:
            primary_id = str(primary["_id"])
            r = await db.users.update_many(
                {"role": "user", "owner_id": {"$exists": False}},
                {"$set": {"owner_id": primary_id}},
            )
            if r.modified_count:
                logger.info(f"owner_id backfilled for {r.modified_count} regular users → {primary_id}")
        # Make sure admins never have owner_id set (self-owned workspace)
        await db.users.update_many({"role": "admin", "owner_id": {"$ne": None}}, {"$set": {"owner_id": None}})
    except Exception as e:
        logger.warning(f"owner_id backfill: {e}")

    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
        scheduler = AsyncIOScheduler(timezone="America/Cuiaba")
        scheduler.add_job(daily_scheduled_email_job, CronTrigger(hour=18, minute=0), id="daily_18h_email", replace_existing=True)
        scheduler.add_job(morning_shutdown_check_job, CronTrigger(hour=8, minute=30), id="morning_shutdown_check", replace_existing=True)
        scheduler.add_job(anexo_iv_reminder_job, CronTrigger(hour=9, minute=0), id="anexo_iv_d2_reminder", replace_existing=True)
        scheduler.add_job(notifications_tick_job, IntervalTrigger(minutes=5), id="notifications_tick", replace_existing=True)
        scheduler.start()
        logger.info("Scheduler started: 08:30 shutdown + 09:00 anexo-IV D-2 + 18:00 tomorrow email + Central de Notificações a cada 5 min (America/Cuiaba)")
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