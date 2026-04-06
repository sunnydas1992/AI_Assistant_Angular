"""
Xray / Jira Test duplicate detection helpers.

Comparable summary rules (must stay aligned with AtlassianService.create_xray_test):
- Xray Jira Test Format: **Test Summary:** from content, else title.
- BDD (Gherkin): scenario title only.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional

from app.services.xray_manual_fields import extract_inline_test_summary

LiteralFormat = str  # 'BDD (Gherkin)' | 'Xray Jira Test Format'


def extract_xray_comparable_summary(test_case: Dict[str, Any], output_format: str) -> str:
    """
    Return the summary string used for duplicate matching and (when publishing) Xray issue summary.
    """
    if output_format == "BDD (Gherkin)":
        return (test_case.get("title") or "").strip()
    content = test_case.get("content") or ""
    inline = extract_inline_test_summary(content).strip()
    if inline:
        return inline
    return (test_case.get("title") or "").strip()


def normalize_xray_summary_for_match(s: str) -> str:
    """
    Normalize for equality: NFKC, casefold, collapse internal whitespace.
    """
    if not s:
        return ""
    t = unicodedata.normalize("NFKC", s)
    t = t.casefold()
    t = re.sub(r"\s+", " ", t).strip()
    return t


def pick_jql_summary_token(summary: str) -> Optional[str]:
    """
    Pick a token for JQL `summary ~ "token"` to narrow candidates.
    Prefer first word-like token with length >= 3; else shorter tokens; cap length.
    """
    if not summary or not str(summary).strip():
        return None
    s = summary.strip()
    words = re.findall(r"[\w][\w.-]*", s, flags=re.UNICODE)
    for w in words:
        if len(w) >= 3:
            return w[:80]
    for w in words:
        if len(w) >= 1:
            return w[:80]
    # Fallback: strip non-word chars for a short prefix
    cleaned = re.sub(r"[^\w\s.-]", "", s, flags=re.UNICODE).strip()
    if cleaned:
        return cleaned.split()[0][:80] if cleaned.split() else cleaned[:40]
    return s[:40] if s else None


def escape_jql_string(value: str) -> str:
    """Escape double quotes and backslashes for use inside JQL double-quoted strings."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def tiebreak_duplicate_issues(issues: List[Any]) -> Any:
    """
    When multiple issues share the same normalized summary, pick the oldest by created date.
    `issues` are jira Issue objects with fields.created.
    """
    if not issues:
        raise ValueError("empty issues")
    if len(issues) == 1:
        return issues[0]

    def created_ts(issue) -> str:
        c = getattr(issue.fields, "created", None) or ""
        return str(c)

    return sorted(issues, key=created_ts)[0]
