"""Tests for the RedactingFilter in logging_config."""

import logging

from app.config.logging_config import RedactingFilter


def _make_record(msg: str, *args) -> logging.LogRecord:
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg=msg, args=args if args else None, exc_info=None,
    )
    return record


class TestRedactingFilter:
    def setup_method(self):
        self.f = RedactingFilter()

    def test_redacts_api_token(self):
        r = _make_record("init with api_token=super-secret-123 done")
        self.f.filter(r)
        assert "super-secret-123" not in r.msg
        assert "REDACTED" in r.msg

    def test_redacts_password(self):
        r = _make_record("login password=hunter2")
        self.f.filter(r)
        assert "hunter2" not in r.msg
        assert "REDACTED" in r.msg

    def test_redacts_bearer_token(self):
        r = _make_record("header authorization=Bearer abc123")
        self.f.filter(r)
        assert "abc123" not in r.msg

    def test_leaves_safe_messages_alone(self):
        r = _make_record("Init requested session_id=abc123 jira_server=https://foo.net")
        self.f.filter(r)
        assert "abc123" in r.msg
        assert "foo.net" in r.msg

    def test_redacts_in_args(self):
        r = _make_record("Setting %s", "api_key=mysecretkey")
        self.f.filter(r)
        assert "mysecretkey" not in r.args[0]
        assert "REDACTED" in r.args[0]

    def test_case_insensitive(self):
        r = _make_record("API_TOKEN=SomeToken123")
        self.f.filter(r)
        assert "SomeToken123" not in r.msg
