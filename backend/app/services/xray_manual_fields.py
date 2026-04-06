"""
Parse generated Xray Jira Test Format content into a short description (Test Summary)
and manual step rows for Xray Test details (Action / Data / Expected Result).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional

XRAY_PUBLISH_FORMAT = "Xray Jira Test Format"


@dataclass
class ParsedXrayManual:
    """Result of parsing one Xray-format test case block."""

    summary_for_description: str
    steps: List[Dict[str, str]]
    source_content: str


def _split_md_table_row(line: str) -> List[str]:
    return [p.strip() for p in line.strip().strip("|").split("|")]


def _normalize_header_cell(cell: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (cell or "").lower())


def _column_indices(header_cells: List[str]) -> Optional[Dict[str, int]]:
    norm = [_normalize_header_cell(c) for c in header_cells]
    action_i: Optional[int] = None
    for i, n in enumerate(norm):
        if n in ("step", "action", "steps") or n.startswith("step"):
            action_i = i
            break
    data_i: Optional[int] = None
    for i, n in enumerate(norm):
        if n == "testdata" or n == "data" or "testdata" in n:
            data_i = i
            break
    result_i: Optional[int] = None
    for i, n in enumerate(norm):
        if "expected" in n or n in ("expectedresult", "result"):
            result_i = i
            break
    if action_i is None or result_i is None:
        return None
    if data_i is None:
        data_i = action_i + 1 if action_i + 1 < len(header_cells) else action_i
    return {"action": action_i, "data": data_i, "result": result_i}


def _parse_steps_table(text: str) -> List[Dict[str, str]]:
    lines = text.splitlines()
    header_idx: Optional[int] = None
    for i, line in enumerate(lines):
        if "|" not in line:
            continue
        low = line.lower()
        if "expected" not in low:
            continue
        if (
            "step" in low
            or "action" in low
            or "test data" in low
            or re.search(r"\|\s*step\s*\|", low)
        ):
            header_idx = i
            break
    if header_idx is None:
        return []

    j = header_idx + 1
    if j < len(lines) and re.match(r"^\s*\|[\s\-:|]+\|\s*$", lines[j]):
        j += 1

    header_cells = _split_md_table_row(lines[header_idx])
    idx_map = _column_indices(header_cells)
    if idx_map is None and len(header_cells) >= 3:
        idx_map = {"action": 0, "data": 1, "result": 2}
    if idx_map is None:
        return []

    out: List[Dict[str, str]] = []

    def cell(cells: List[str], key: str) -> str:
        k = idx_map[key]  # type: ignore[index]
        if k is None or k >= len(cells):
            return ""
        return cells[k].strip()

    while j < len(lines):
        line = lines[j]
        stripped = line.strip()
        if not stripped:
            break
        if "|" not in line:
            break
        if re.match(r"^\s*\|[\s\-:|]+\|\s*$", line):
            j += 1
            continue
        cells = _split_md_table_row(line)
        if len(cells) < 2:
            j += 1
            continue
        row = {
            "action": cell(cells, "action"),
            "data": cell(cells, "data"),
            "result": cell(cells, "result"),
        }
        if any(row.values()):
            out.append(row)
        j += 1

    return out


def _extract_test_summary_line(text: str) -> str:
    # Bold markdown: **Test Summary:**
    m = re.search(r"\*\*Test Summary:\*\*\s*(.+?)(?:\n|$)", text, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r"\s+", " ", m.group(1).strip())
    # Italic: *Test Summary:* text (colon then closing asterisk — common in LLM output)
    m2 = re.search(
        r"(?im)^\s*\*+\s*Test\s*Summary:\s*\*+\s*(.+)$",
        text,
    )
    if m2:
        return re.sub(r"\s+", " ", m2.group(1).strip())
    # Alternate: *Test Summary*: text (colon after closing asterisk)
    m2b = re.search(
        r"(?im)^\s*\*+\s*Test\s*Summary\s*\*+\s*:\s*(.+)$",
        text,
    )
    if m2b:
        return re.sub(r"\s+", " ", m2b.group(1).strip())
    # Plain "Test Summary:" (no emphasis)
    m3 = re.search(r"(?im)^\s*Test\s*Summary\s*:\s*(.+)$", text)
    if m3:
        return re.sub(r"\s+", " ", m3.group(1).strip())
    return ""


def extract_inline_test_summary(content: str) -> str:
    """First line of test objective from Xray-style markdown (used for Jira summary + duplicate match)."""
    return _extract_test_summary_line(content or "")


def parse_xray_manual_content(content: str) -> ParsedXrayManual:
    """
    Extract Test Summary text (for Jira Description) and manual steps from markdown.
    """
    raw = (content or "").strip()
    summary = _extract_test_summary_line(raw)
    steps = _parse_steps_table(raw)
    return ParsedXrayManual(
        summary_for_description=summary,
        steps=steps,
        source_content=raw,
    )


def content_looks_like_xray_manual(content: str) -> bool:
    """True when markdown parses to at least one manual step row (declared output_format may still be BDD)."""
    if not (content or "").strip() or "|" not in content:
        return False
    return len(parse_xray_manual_content(content).steps) > 0


def effective_xray_publish_format(content: str, declared_format: str) -> str:
    """
    Use Xray publish path (short description + step API) when the UI format is Xray or the body is Xray-shaped.
    """
    d = (declared_format or "").strip()
    if d == XRAY_PUBLISH_FORMAT:
        return d
    if content_looks_like_xray_manual(content):
        return XRAY_PUBLISH_FORMAT
    return d
