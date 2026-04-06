"""Unit tests for Xray duplicate summary extraction and normalization."""

import pytest

from app.services.xray_duplicate import (
    extract_xray_comparable_summary,
    normalize_xray_summary_for_match,
    pick_jql_summary_token,
    tiebreak_duplicate_issues,
)


def test_extract_bdd_uses_title_only():
    tc = {
        "title": "  My Scenario ",
        "content": "**Test Summary:** Should not use this in BDD mode",
    }
    assert extract_xray_comparable_summary(tc, "BDD (Gherkin)") == "My Scenario"


def test_extract_xray_prefers_test_summary():
    tc = {
        "title": "Fallback title",
        "content": "intro\n**Test Summary:** Real Summary Line\nmore text",
    }
    assert extract_xray_comparable_summary(tc, "Xray Jira Test Format") == "Real Summary Line"


def test_extract_xray_falls_back_to_title():
    tc = {"title": "Only Title", "content": "no summary marker here"}
    assert extract_xray_comparable_summary(tc, "Xray Jira Test Format") == "Only Title"


def test_normalize_collapses_whitespace_and_casefold():
    assert normalize_xray_summary_for_match("  Hello   World  ") == "hello world"
    assert normalize_xray_summary_for_match("HELLO") == "hello"


def test_pick_jql_summary_token_prefers_longer_words():
    assert pick_jql_summary_token("Successful login flow") == "Successful"
    assert pick_jql_summary_token("AB flow") == "flow"


def test_pick_jql_summary_token_short_fallback():
    assert pick_jql_summary_token("AB") == "AB"


def test_tiebreak_duplicate_issues_oldest_created():
    class Fields:
        def __init__(self, created: str):
            self.created = created

    class Issue:
        def __init__(self, key: str, created: str):
            self.key = key
            self.fields = Fields(created)

    newer = Issue("A-2", "2024-06-02T10:00:00.000+0000")
    older = Issue("A-1", "2024-01-01T10:00:00.000+0000")
    chosen = tiebreak_duplicate_issues([newer, older])
    assert chosen.key == "A-1"


def test_tiebreak_single_issue():
    class Fields:
        created = "2024-01-01"

    class Issue:
        key = "X-1"
        fields = Fields()

    only = Issue()
    assert tiebreak_duplicate_issues([only]).key == "X-1"
