"""
Smoke tests for the QA Assistant API.
These run against the FastAPI app without real Jira/AWS connections,
verifying routing, input validation, health checks, and error handling.
"""

import pytest


class TestHealth:
    def test_health_returns_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert "uptime_seconds" in body
        assert "active_sessions" in body
        assert body["thread_pool_alive"] is True

    def test_health_cors_headers(self, client):
        resp = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:4200",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert "access-control-allow-origin" in resp.headers


class TestInitValidation:
    """Verify the /api/init endpoint rejects bad input before touching external services."""

    def test_init_missing_jira_server(self, client):
        resp = client.post("/api/init", data={
            "jira_server": "",
            "jira_username": "user@test.com",
            "jira_api_token": "fake-token",
        })
        assert resp.status_code == 400
        assert "jira server" in resp.json()["detail"].lower() or "required" in resp.json()["detail"].lower()

    def test_init_missing_username(self, client):
        resp = client.post("/api/init", data={
            "jira_server": "https://fake.atlassian.net",
            "jira_username": "",
            "jira_api_token": "fake-token",
        })
        assert resp.status_code == 400

    def test_init_missing_token(self, client):
        resp = client.post("/api/init", data={
            "jira_server": "https://fake.atlassian.net",
            "jira_username": "user@test.com",
            "jira_api_token": "",
        })
        assert resp.status_code == 400


class TestInputGuardrails:
    """Verify input length limits are enforced."""

    def test_chat_message_too_long(self, client):
        long_msg = "x" * 15_000
        resp = client.post("/api/chat/message", data={"message": long_msg})
        assert resp.status_code in (400, 422)

    def test_post_to_jira_too_long(self, client):
        long_content = "x" * 60_000
        resp = client.post("/api/chat/post-to-jira", data={"content": long_content})
        assert resp.status_code in (400, 422)


class TestUninitializedGuard:
    """Endpoints that require an initialized session should fail gracefully."""

    def test_chat_without_init(self, client):
        resp = client.post("/api/chat/message", data={"message": "hello"})
        # Should fail because no session is initialized (400 from length or 400/500 from missing session)
        assert resp.status_code in (400, 500)

    def test_kb_count_without_init(self, client):
        resp = client.get("/api/kb/count")
        assert resp.status_code in (400, 500)

    def test_test_cases_generate_without_init(self, client):
        resp = client.post("/api/test-cases/generate", data={
            "target_id": "FAKE-1",
            "source_type": "jira",
            "output_format": "BDD (Gherkin)",
        })
        assert resp.status_code in (400, 500)


class TestInitStatus:
    def test_init_status_not_initialized(self, client):
        resp = client.get("/api/init-status")
        assert resp.status_code == 200
        body = resp.json()
        assert body["initialized"] is False


class TestDisconnect:
    def test_disconnect_without_session(self, client):
        resp = client.post("/api/disconnect")
        assert resp.status_code == 200
