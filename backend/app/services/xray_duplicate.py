"""
Xray / Jira Test duplicate detection helpers.

Comparable summary rules (must stay aligned with AtlassianService.create_xray_test):
- Xray Jira Test Format: **Test Summary:** from content, else title.
- BDD (Gherkin): scenario title only.

Matching strategy (applied in order):
1. Exact normalized match (casefold + whitespace collapse).
2. Semantic similarity via sentence embeddings (cosine similarity >= threshold).
"""

from __future__ import annotations

import logging
import math
import re
import unicodedata
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.services.xray_manual_fields import extract_inline_test_summary

logger = logging.getLogger(__name__)

LiteralFormat = str  # 'BDD (Gherkin)' | 'Xray Jira Test Format'

SEMANTIC_SIMILARITY_THRESHOLD = 0.80


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


# ---------------------------------------------------------------------------
# Semantic similarity helpers
# ---------------------------------------------------------------------------

def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors without requiring numpy."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def find_semantic_match(
    target_summary: str,
    candidates: List[Tuple[Any, str]],
    embed_fn: Callable[[List[str]], List[List[float]]],
    threshold: float = SEMANTIC_SIMILARITY_THRESHOLD,
) -> Optional[Tuple[Any, float]]:
    """
    Find the best semantic match for *target_summary* among Jira issue *candidates*.

    Args:
        target_summary: The generated test case summary to match.
        candidates: List of (jira_issue, raw_summary_string) tuples from JQL results.
        embed_fn: A function that accepts a list of strings and returns a list of embedding vectors.
        threshold: Minimum cosine similarity to consider a match.

    Returns:
        (best_issue, similarity_score) if a match >= threshold is found, else None.
    """
    if not target_summary or not candidates:
        return None

    candidate_summaries = [s for _, s in candidates]
    all_texts = [target_summary] + candidate_summaries

    try:
        embeddings = embed_fn(all_texts)
    except Exception as e:
        logger.warning("Semantic embedding failed, skipping similarity check: %s", e)
        return None

    target_vec = embeddings[0]
    best_score = 0.0
    best_issue = None

    for i, (issue, _) in enumerate(candidates):
        score = _cosine_similarity(target_vec, embeddings[i + 1])
        if score > best_score:
            best_score = score
            best_issue = issue

    if best_score >= threshold and best_issue is not None:
        return best_issue, round(best_score, 3)
    return None
