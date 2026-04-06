"""Tests for Xray-format parsing (summary + manual steps table)."""

from app.services.xray_manual_fields import (
    effective_xray_publish_format,
    extract_inline_test_summary,
    parse_xray_manual_content,
)


def test_parse_summary_and_three_column_table():
    content = """**Test Case 1:**
**Test Summary:** Verify admin can log in.
**Steps:**
| Step | Test Data | Expected Result |
|---|---|---|
| Navigate to login. | None | Page shown. |
| Enter credentials. | user / pass | Logged in. |
"""
    p = parse_xray_manual_content(content)
    assert p.summary_for_description == "Verify admin can log in."
    assert len(p.steps) == 2
    assert p.steps[0]["action"] == "Navigate to login."
    assert p.steps[0]["data"] == "None"
    assert p.steps[0]["result"] == "Page shown."
    assert p.steps[1]["result"] == "Logged in."


def test_parse_action_column_header():
    content = """**Test Summary:** Short summary here.
| Action | Test Data | Expected Result |
|--------|-----------|------------------|
| Do thing | x | y |
"""
    p = parse_xray_manual_content(content)
    assert "Short summary" in p.summary_for_description
    assert len(p.steps) == 1
    assert p.steps[0]["action"] == "Do thing"


def test_no_table_keeps_steps_empty():
    content = "**Test Summary:** Only summary, no table."
    p = parse_xray_manual_content(content)
    assert p.steps == []
    assert p.summary_for_description == "Only summary, no table."


def test_single_asterisk_test_summary():
    content = """*Test Case 10:*
*Test Summary:* Verify encryption of the same string.
*Steps:*
| Step | Test Data | Expected Result |
|---|---|---|
| 1. Do thing | x | y |
"""
    assert extract_inline_test_summary(content) == "Verify encryption of the same string."
    p = parse_xray_manual_content(content)
    assert len(p.steps) == 1


def test_effective_format_bdd_ui_but_xray_body():
    body = """**Test Summary:** From ticket.
| Step | Test Data | Expected Result |
|---|---|---|
| Act | Data | Exp |
"""
    assert effective_xray_publish_format(body, "BDD (Gherkin)") == "Xray Jira Test Format"
    assert effective_xray_publish_format(body, "Xray Jira Test Format") == "Xray Jira Test Format"
