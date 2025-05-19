import os
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Import the FastAPI app and the database module we need to monkey-patch
from backend import main as backend_main
from backend import database as db


def _make_test_connection(db_file: Path):
    """Return a fresh connection to the temporary database file."""
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture(scope="session")
def client(tmp_path_factory, monkeypatch):
    """Spin up TestClient with an isolated SQLite database."""
    tmp_dir = tmp_path_factory.mktemp("data")
    test_db_path = tmp_dir / "scripts_test.db"

    # Monkey-patch the get_db_connection function to use our temp file
    monkeypatch.setattr(db, "get_db_connection", lambda: _make_test_connection(test_db_path))

    # Re-initialise the schema in the new database file
    db.init_db()

    with TestClient(backend_main.app) as c:
        yield c


SCRIPT_PAYLOAD = {
    "name": "Test Script",
    "description": "A script for unit testing",
    "body": "#!/bin/bash\necho Hello World",
    "category": "Tests"
}


def test_save_script(client):
    response = client.post("/api/fs/save-script", json=SCRIPT_PAYLOAD)
    assert response.status_code == 200

    # Saving again with same payload should still succeed (upsert)
    response2 = client.post("/api/fs/save-script", json=SCRIPT_PAYLOAD)
    assert response2.status_code == 200


def test_get_scripts_and_categories(client):
    # Get list of scripts
    resp = client.get("/api/fs/scripts")
    assert resp.status_code == 200
    data = resp.json()
    assert any(s["name"] == SCRIPT_PAYLOAD["name"] for s in data["scripts"])

    # Get categories
    resp_cat = client.get("/api/fs/categories")
    assert resp_cat.status_code == 200
    assert SCRIPT_PAYLOAD["category"] in resp_cat.json()["categories"]


def test_get_single_script(client):
    resp = client.get(f"/api/fs/scripts/{SCRIPT_PAYLOAD['name']}")
    assert resp.status_code == 200
    script = resp.json()
    assert script["description"] == SCRIPT_PAYLOAD["description"]


def test_script_args_flow(client):
    # Initially there should be no args
    r = client.get(f"/api/fs/scripts/{SCRIPT_PAYLOAD['name']}/args")
    assert r.status_code == 200
    assert r.json()["args"] == []

    # Simulate saving args via backend helper
    db.save_script_args(SCRIPT_PAYLOAD["name"], "--foo 1")
    db.save_script_args(SCRIPT_PAYLOAD["name"], "--bar 2")

    r2 = client.get(f"/api/fs/scripts/{SCRIPT_PAYLOAD['name']}/args")
    assert r2.status_code == 200
    history = r2.json()["args"]
    # Latest first
    assert history[0] == "--bar 2"
    assert "--foo 1" in history


def test_rename_script(client):
    payload = {
        "old_name": SCRIPT_PAYLOAD["name"],
        "new_name": "Test Script Renamed",
        "description": SCRIPT_PAYLOAD["description"],
        "body": SCRIPT_PAYLOAD["body"],
        "category": SCRIPT_PAYLOAD["category"],
    }
    resp = client.post("/api/fs/rename-script", json=payload)
    assert resp.status_code == 200

    # Verify old name no longer exists, new one does
    r_old = client.get(f"/api/fs/scripts/{SCRIPT_PAYLOAD['name']}")
    assert r_old.status_code == 404

    r_new = client.get(f"/api/fs/scripts/{payload['new_name']}")
    assert r_new.status_code == 200


def test_delete_script(client):
    new_name = "Test Script Renamed"
    resp = client.delete(f"/api/fs/scripts/{new_name}")
    assert resp.status_code == 200

    resp_check = client.get(f"/api/fs/scripts/{new_name}")
    assert resp_check.status_code == 404