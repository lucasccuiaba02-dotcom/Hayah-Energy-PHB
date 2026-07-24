from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from bson import ObjectId
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import os
import logging
import bcrypt
import jwt
import secrets
import asyncio
import base64

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"

# Project type labels (Hayah Energy specific)
PROJECT_TYPE_LABELS = {
    "anexo_iv": "ANEXO IV",
    "po": "P.O",
    "nivel_tensao": "Nível de Tensão",
    "seguranca": "Segurança",
    "particular": "Particular",
    "extensao_rede_bt": "Extensão de Rede BT",
    "extensao_rede_mt": "Extensão de Rede MT",
    "extensao_rede_monofasica_rural": "Extensão Rede Monofásica Rural",
    "regulador": "Regulador",
    "religador": "Religador",
    "troca_trafo_mono": "Troca Trafo Mono",
    "troca_trafo_tri": "Troca Trafo Tri",
}

EXECUTION_STATUS_LABELS = {
    "aguardando_inicio": "Aguardando Início",
    "programado": "Programado",
    "em_execucao": "Em Execução",
    "concluido": "Concluído",
    "cancelado": "Cancelado",
}

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
    created_at: str
    access_token: Optional[str] = None

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
    team_id: Optional[str] = None
    team_name: Optional[str] = None
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
    execution_status: str = "aguardando_inicio"
    is_scheduled: bool = False

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    project_code: Optional[str] = None
    team_id: Optional[str] = None
    team_name: Optional[str] = None
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

class ProjectResponse(BaseModel):
    id: str
    name: str
    project_code: str = ""
    team_id: Optional[str] = None
    team_name: Optional[str] = None
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
    execution_status: str = "aguardando_inicio"
    is_scheduled: bool = False
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
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    
    return UserResponse(
        id=user_id,
        email=email,
        name=user_data.name,
        role="user",
        created_at=user_doc["created_at"].isoformat(),
        access_token=access_token,
    )

@api_router.post("/auth/login", response_model=UserResponse)
async def login(credentials: UserLogin, response: Response, request: Request):
    email = credentials.email.lower()
    user = await db.users.find_one({"email": email})
    
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
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
        created_at=current_user["created_at"].isoformat()
    )

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
        team_id=project.get("team_id"),
        team_name=project.get("team_name"),
        start_date=project.get("start_date", ""),
        end_date=project.get("end_date", ""),
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
        execution_status=project.get("execution_status", "aguardando_inicio"),
        is_scheduled=project.get("is_scheduled", False),
        created_at=project["created_at"].isoformat() if hasattr(project["created_at"], 'isoformat') else project["created_at"],
    )

# Project Routes
@api_router.post("/projects", response_model=ProjectResponse)
async def create_project(project_data: ProjectCreate, current_user: dict = Depends(get_current_user)):
    project_doc = {
        **project_data.model_dump(),
        "created_at": datetime.now(timezone.utc),
        "user_id": current_user["_id"]
    }
    # Auto-set execution_status when scheduling
    if project_doc.get("is_scheduled") and project_doc.get("execution_status") == "aguardando_inicio":
        project_doc["execution_status"] = "programado"
    
    result = await db.projects.insert_one(project_doc)
    project_doc["_id"] = result.inserted_id
    
    # Fire email notification (fire-and-forget) if project is being scheduled
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
    update_data = {k: v for k, v in project_data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.projects.update_one(
        {"_id": safe_object_id(project_id), "user_id": current_user["_id"]},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project = await db.projects.find_one({"_id": safe_object_id(project_id)})
    return build_project_response(project)

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
import io

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
        ps = (p.get("start_date") or "")[:10]
        pe = (p.get("end_date") or "")[:10]
        if not ps:
            continue
        tid = p.get("team_id") or "unassigned"
        # For each date in project span that falls within range
        try:
            p_start = dt.fromisoformat(ps).date()
            p_end = dt.fromisoformat(pe).date() if pe else p_start
        except Exception:
            continue
        cursor = max(p_start, start_dt)
        finish = min(p_end, end_dt)
        while cursor <= finish:
            date_iso = cursor.isoformat()
            if tid in grid and date_iso in grid[tid]:
                grid[tid][date_iso].append({
                    "id": str(p["_id"]),
                    "code": p.get("project_code") or p.get("name", ""),
                    "name": p.get("name", ""),
                    "execution_status": p.get("execution_status", "aguardando_inicio"),
                    "requires_hot_line": p.get("requires_hot_line", False),
                    "shutdown_info": p.get("shutdown_info", ""),
                    "location": p.get("location", ""),
                })
            cursor += td(days=1)
    
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

@api_router.post("/materials/request")
async def request_materials(
    current_user: dict = Depends(get_current_user),
    project_id: str = Form(...),
    notes: str = Form(""),
    material_pdf: Optional[UploadFile] = File(None),
    project_pdf: Optional[UploadFile] = File(None),
):
    """Send material request email to warehouse with PDF attachments"""
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    warehouse_email = os.environ.get("WAREHOUSE_EMAIL", "").strip()
    fallback_emails = os.environ.get("NOTIFICATION_EMAILS", "")
    if warehouse_email:
        recipients = [warehouse_email]
    else:
        recipients = [e.strip() for e in fallback_emails.split(",") if e.strip()]
    
    if not recipients:
        raise HTTPException(status_code=400, detail="Nenhum destinatário configurado")
    
    # Read attachments
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
    
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #E0FF00; background: #050505; padding: 16px; margin: 0;">HAYAH ENERGY</h1>
      <div style="background: #050505; color: #fff; padding: 24px;">
        <h2 style="color: #00F0FF; margin-top: 0;">Solicitação de Material</h2>
        <table width="100%" style="border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #a1a1aa; width: 40%;">Projeto:</td><td style="color: #fff; font-weight: bold;">{project.get('name','')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Código:</td><td style="color: #fff;">{project.get('project_code','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Tipo:</td><td style="color: #fff;">{PROJECT_TYPE_LABELS.get(project.get('project_type'), '')}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Localidade:</td><td style="color: #fff;">{project.get('location','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Equipe:</td><td style="color: #fff;">{project.get('team_name','') or '-'}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Período:</td><td style="color: #fff;">{(project.get('start_date') or '')[:10]} → {(project.get('end_date') or '')[:10]}</td></tr>
          <tr><td style="padding: 6px 0; color: #a1a1aa;">Solicitado por:</td><td style="color: #fff;">{current_user.get('name','')}</td></tr>
        </table>
        {'<div style="margin-top: 20px; padding: 12px; background: rgba(255,255,255,0.05); border-left: 3px solid #E0FF00;"><p style="margin: 0; color: #fff;">' + notes + '</p></div>' if notes else ''}
        <p style="color: #71717a; font-size: 11px; margin-top: 24px;">Anexos: {len(attachments)} arquivo(s)</p>
      </div>
    </div>
    """
    subject = f"[HAYAH] Solicitação de Material: {project.get('name','')}"
    
    # Send via Resend with attachments
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[MATERIAL EMAIL SKIPPED - No RESEND_API_KEY] To={recipients}")
        return {"status": "skipped", "reason": "no_api_key", "attachments_count": len(attachments)}
    
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
        return {"status": "sent", "id": result.get("id"), "attachments_count": len(attachments)}
    except Exception as e:
        logger.error(f"Failed to send material request: {e}")
        return {"status": "error", "error": str(e)}

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
    
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        hashed = hash_password(admin_password)
        await db.users.insert_one({"email": admin_email, "password_hash": hashed, "name": "Admin", "role": "admin", "created_at": datetime.now(timezone.utc)})
        logger.info(f"Admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Admin password updated")
    
    # Start scheduler for daily 18:00 email
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        scheduler = AsyncIOScheduler(timezone="America/Cuiaba")
        scheduler.add_job(daily_scheduled_email_job, CronTrigger(hour=18, minute=0), id="daily_18h_email", replace_existing=True)
        scheduler.add_job(morning_shutdown_check_job, CronTrigger(hour=8, minute=30), id="morning_shutdown_check", replace_existing=True)
        scheduler.start()
        logger.info("Scheduler started: 08:30 shutdown check + 18:00 tomorrow email (America/Cuiaba)")
    except Exception as e:
        logger.warning(f"Failed to start scheduler: {e}")
    
    # Write test credentials
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