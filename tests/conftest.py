# tests/conftest.py

import pytest
from fastapi.testclient import TestClient
from backend.main import app  # Adjust the import based on your app's location

@pytest.fixture
def client():
    """Provides a TestClient instance."""
    return TestClient(app)
