"""Shared fixtures for backend tests."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """Create a TestClient for the FastAPI app without starting external services."""
    from main import app
    with TestClient(app) as c:
        yield c
