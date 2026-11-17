"""测试隔离：使用临时数据库与规则 AI，绝不触碰本地演示库。"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TEST_DIR = Path(tempfile.mkdtemp(prefix="flowdesk-test-"))
os.environ.update(
    ENV="test",
    DATA_DIR=str(TEST_DIR),
    DATABASE_PATH=str(TEST_DIR / "test.db"),
    SEED_DEMO="1",
    ADMIN_EMAIL="admin@flowdesk.dev",
    ADMIN_PASSWORD="TestAdmin@12345",
    DEMO_EMAIL="demo@flowdesk.dev",
    DEMO_PASSWORD="Demo@12345",
    AI_MODE="rules",
    COOKIE_SECURE="0",
)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client
    shutil.rmtree(TEST_DIR, ignore_errors=True)


def login(client: TestClient, email: str = "demo@flowdesk.dev",
          password: str = "Demo@12345") -> dict:
    client.cookies.clear()
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()
