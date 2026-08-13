"""Regression tests for multi-tenant owner_id auto-healing (Fev/2026).

Bug: A user who owned data could be inadvertently reassigned to another admin's
workspace via `owner_id`, losing access to their own projects. `get_current_user`
now auto-heals this and `POST /api/auth/repair-my-workspace` provides an
explicit recovery path.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

ADMIN_A = f"admin_a_multi_{int(time.time())}@hayah.com"
TARGET = f"target_multi_{int(time.time())}@hayah.com"
PASSWORD = "HayahMulti$2026"

ALL_PERMS = ['dashboard', 'operacional', 'carteira', 'programacao', 'calendario',
             'geolocalizacao', 'materiais', 'analise', 'relatorios', 'equipes',
             'estoque', 'faturamento', 'documentos', 'settings', 'admin']


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO)
    return c[DB_NAME]


def _register_and_approve_as_admin(db, email):
    """Register user via API, then force role=admin (bypass admin-approve flow)."""
    db.users.delete_many({'email': email})
    r = requests.post(f'{API}/auth/register', json={'email': email, 'password': PASSWORD, 'name': email.split('@')[0]})
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    db.users.update_one({'email': email}, {'$set': {
        'status': 'approved', 'role': 'admin', 'owner_id': None,
        'permissions': ALL_PERMS
    }})
    return db.users.find_one({'email': email})


def _login(email):
    r = requests.post(f'{API}/auth/login', json={'email': email, 'password': PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()['access_token']


@pytest.fixture(scope="module", autouse=True)
def cleanup(db):
    """Ensure a clean environment before + after."""
    for e in [ADMIN_A, TARGET]:
        db.users.delete_many({'email': e})
    yield
    # collect ids to delete their data
    for e in [ADMIN_A, TARGET]:
        u = db.users.find_one({'email': e})
        if u:
            uid = str(u['_id'])
            db.projects.delete_many({'user_id': uid})
            db.teams.delete_many({'user_id': uid})
        db.users.delete_many({'email': e})


def test_auto_heal_when_owner_id_wrongly_set(db):
    """A user with own projects but wrongly assigned owner_id should be auto-healed
    on the next authenticated request."""
    admin_a = _register_and_approve_as_admin(db, ADMIN_A)
    target = _register_and_approve_as_admin(db, TARGET)

    # Target logs in and creates a project (so they have own data)
    token = _login(TARGET)
    h = {'Authorization': f'Bearer {token}'}
    r = requests.post(f'{API}/projects', headers=h,
                     json={'name': 'MTHEAL_TEST', 'project_code': f'MTHEAL-{int(time.time())}', 'programmed_value': 100})
    assert r.status_code == 200, f"create failed: {r.text[:200]}"
    pid = r.json()['id']

    # Simulate corruption: demote target to user + assign to admin A
    db.users.update_one({'_id': target['_id']}, {'$set': {
        'role': 'user', 'owner_id': str(admin_a['_id']), 'permissions': ['dashboard']
    }})

    # Now target logs in again → get_current_user should auto-heal
    token2 = _login(TARGET)
    h2 = {'Authorization': f'Bearer {token2}'}
    me = requests.get(f'{API}/auth/me', headers=h2).json()
    assert me['role'] == 'admin', f'expected role=admin after heal, got {me["role"]}'
    assert 'admin' in me['permissions'], 'admin permission restored'

    # Own project still accessible
    projs = requests.get(f'{API}/projects', headers=h2).json()
    codes = [p.get('project_code') for p in projs]
    assert any('MTHEAL' in (c or '') for c in codes), f'own project not restored: {codes}'

    # DB state should reflect the heal
    healed = db.users.find_one({'_id': target['_id']})
    assert healed['role'] == 'admin'
    assert healed.get('owner_id') is None

    # Cleanup project
    requests.delete(f'{API}/projects/{pid}', headers=h2)


def test_repair_endpoint_explicit_recovery(db):
    """POST /auth/repair-my-workspace works even when directly called."""
    target = _register_and_approve_as_admin(db, TARGET)
    token = _login(TARGET)
    h = {'Authorization': f'Bearer {token}'}

    # Target has own data
    r = requests.post(f'{API}/projects', headers=h,
                     json={'name': 'MTREP_TEST', 'project_code': f'MTREP-{int(time.time())}', 'programmed_value': 50})
    pid = r.json()['id']

    # Call repair endpoint directly (already healthy)
    r = requests.post(f'{API}/auth/repair-my-workspace', headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body['status'] in ('repaired', 'already_healthy'), body
    assert body['own_projects'] >= 1

    requests.delete(f'{API}/projects/{pid}', headers=h)


def test_admin_approve_preserves_user_with_own_data(db):
    """Approving a user who ALREADY has projects should auto-promote them to admin
    (not overwrite their workspace with the approver's data namespace)."""
    admin_a = _register_and_approve_as_admin(db, ADMIN_A)
    target = _register_and_approve_as_admin(db, TARGET)

    # Target creates own project
    t_token = _login(TARGET)
    r = requests.post(f'{API}/projects', headers={'Authorization': f'Bearer {t_token}'},
                     json={'name': 'MTAPPR_TEST', 'project_code': f'MTAPPR-{int(time.time())}', 'programmed_value': 25})
    pid = r.json()['id']

    # Reset target to pending regular user (as if newly registered)
    db.users.update_one({'_id': target['_id']}, {'$set': {
        'status': 'pending', 'role': 'user', 'owner_id': None, 'permissions': []
    }})

    # Admin A now approves target as regular user with limited perms
    a_token = _login(ADMIN_A)
    r = requests.post(f'{API}/admin/users/{target["_id"]}/approve',
                     headers={'Authorization': f'Bearer {a_token}'},
                     json={'permissions': ['dashboard'], 'role': 'user'})
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    # Auto-promoted because target had own project(s)
    assert body['role'] == 'admin', f'expected auto-promotion to admin, got {body}'
    assert body['owner_id'] is None
    assert body.get('own_projects_preserved', 0) >= 1

    # Cleanup — target's session was bumped when re-approved, so relogin
    t = _login(TARGET)
    requests.delete(f'{API}/projects/{pid}', headers={'Authorization': f'Bearer {t}'})
