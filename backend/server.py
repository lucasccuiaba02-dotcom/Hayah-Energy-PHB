from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
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

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"

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

class TeamResponse(BaseModel):
    id: str
    name: str
    members: List[str]
    created_at: str

class ProjectCreate(BaseModel):
    name: str
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    start_date: str
    end_date: str
    programmed_value: float
    daily_goal: float
    status: str = "active"
    priority: str = "medium"
    actual_value: float = 0.0

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    programmed_value: Optional[float] = None
    daily_goal: Optional[float] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    actual_value: Optional[float] = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    start_date: str
    end_date: str
    programmed_value: float
    daily_goal: float
    status: str
    priority: str
    actual_value: float
    created_at: str

class DashboardStats(BaseModel):
    total_projects: int
    active_projects: int
    total_programmed: float
    total_actual: float
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

# Team Routes
@api_router.post("/teams", response_model=TeamResponse)
async def create_team(team_data: TeamCreate, current_user: dict = Depends(get_current_user)):
    team_doc = {
        "name": team_data.name,
        "members": team_data.members,
        "created_at": datetime.now(timezone.utc),
        "user_id": current_user["_id"]
    }
    result = await db.teams.insert_one(team_doc)
    return TeamResponse(
        id=str(result.inserted_id),
        name=team_data.name,
        members=team_data.members,
        created_at=team_doc["created_at"].isoformat()
    )

@api_router.get("/teams", response_model=List[TeamResponse])
async def get_teams(current_user: dict = Depends(get_current_user)):
    teams = await db.teams.find({"user_id": current_user["_id"]}, {"_id": 1, "name": 1, "members": 1, "created_at": 1}).to_list(1000)
    return [TeamResponse(
        id=str(team["_id"]),
        name=team["name"],
        members=team.get("members", []),
        created_at=team["created_at"].isoformat()
    ) for team in teams]

@api_router.get("/teams/{team_id}", response_model=TeamResponse)
async def get_team(team_id: str, current_user: dict = Depends(get_current_user)):
    team = await db.teams.find_one({"_id": safe_object_id(team_id), "user_id": current_user["_id"]})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return TeamResponse(
        id=str(team["_id"]),
        name=team["name"],
        members=team.get("members", []),
        created_at=team["created_at"].isoformat()
    )

@api_router.put("/teams/{team_id}", response_model=TeamResponse)
async def update_team(team_id: str, team_data: TeamCreate, current_user: dict = Depends(get_current_user)):
    result = await db.teams.update_one(
        {"_id": safe_object_id(team_id), "user_id": current_user["_id"]},
        {"$set": {"name": team_data.name, "members": team_data.members}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Team not found")
    team = await db.teams.find_one({"_id": safe_object_id(team_id)})
    return TeamResponse(
        id=str(team["_id"]),
        name=team["name"],
        members=team.get("members", []),
        created_at=team["created_at"].isoformat()
    )

@api_router.delete("/teams/{team_id}")
async def delete_team(team_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.teams.delete_one({"_id": safe_object_id(team_id), "user_id": current_user["_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Team not found")
    return {"message": "Team deleted successfully"}

# Project Routes
@api_router.post("/projects", response_model=ProjectResponse)
async def create_project(project_data: ProjectCreate, current_user: dict = Depends(get_current_user)):
    project_doc = {
        "name": project_data.name,
        "team_id": project_data.team_id,
        "team_name": project_data.team_name,
        "start_date": project_data.start_date,
        "end_date": project_data.end_date,
        "programmed_value": project_data.programmed_value,
        "daily_goal": project_data.daily_goal,
        "status": project_data.status,
        "priority": project_data.priority,
        "actual_value": project_data.actual_value,
        "created_at": datetime.now(timezone.utc),
        "user_id": current_user["_id"]
    }
    result = await db.projects.insert_one(project_doc)
    return ProjectResponse(
        id=str(result.inserted_id),
        name=project_data.name,
        team_id=project_data.team_id,
        team_name=project_data.team_name,
        start_date=project_data.start_date,
        end_date=project_data.end_date,
        programmed_value=project_data.programmed_value,
        daily_goal=project_data.daily_goal,
        status=project_data.status,
        priority=project_data.priority,
        actual_value=project_data.actual_value,
        created_at=project_doc["created_at"].isoformat()
    )

@api_router.get("/projects", response_model=List[ProjectResponse])
async def get_projects(current_user: dict = Depends(get_current_user)):
    projects = await db.projects.find({"user_id": current_user["_id"]}).to_list(1000)
    return [ProjectResponse(
        id=str(project["_id"]),
        name=project["name"],
        team_id=project.get("team_id"),
        team_name=project.get("team_name"),
        start_date=project["start_date"],
        end_date=project["end_date"],
        programmed_value=project["programmed_value"],
        daily_goal=project["daily_goal"],
        status=project["status"],
        priority=project["priority"],
        actual_value=project.get("actual_value", 0.0),
        created_at=project["created_at"].isoformat()
    ) for project in projects]

@api_router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(
        id=str(project["_id"]),
        name=project["name"],
        team_id=project.get("team_id"),
        team_name=project.get("team_name"),
        start_date=project["start_date"],
        end_date=project["end_date"],
        programmed_value=project["programmed_value"],
        daily_goal=project["daily_goal"],
        status=project["status"],
        priority=project["priority"],
        actual_value=project.get("actual_value", 0.0),
        created_at=project["created_at"].isoformat()
    )

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
    return ProjectResponse(
        id=str(project["_id"]),
        name=project["name"],
        team_id=project.get("team_id"),
        team_name=project.get("team_name"),
        start_date=project["start_date"],
        end_date=project["end_date"],
        programmed_value=project["programmed_value"],
        daily_goal=project["daily_goal"],
        status=project["status"],
        priority=project["priority"],
        actual_value=project.get("actual_value", 0.0),
        created_at=project["created_at"].isoformat()
    )

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
    active_projects = len([p for p in projects if p["status"] == "active"])
    total_programmed = sum(p["programmed_value"] for p in projects)
    total_actual = sum(p.get("actual_value", 0.0) for p in projects)
    total_teams = len(teams)
    
    projects_on_track = 0
    projects_lagging = 0
    
    for project in projects:
        actual = project.get("actual_value", 0.0)
        daily_goal = project["daily_goal"]
        
        from datetime import datetime as dt
        start_date_str = project["start_date"]
        # Parse date - handle both date-only and datetime strings
        if 'T' in start_date_str:
            start_date = dt.fromisoformat(start_date_str.replace('Z', '+00:00'))
        else:
            start_date = dt.fromisoformat(start_date_str)
        # Ensure timezone awareness
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
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
        total_teams=total_teams,
        projects_on_track=projects_on_track,
        projects_lagging=projects_lagging
    )

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