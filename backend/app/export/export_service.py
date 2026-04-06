"""
Export Service Module - Test cases and test plans in Excel, JSON, Markdown, CSV.
"""

import json
from io import BytesIO
from typing import List, Dict, Any, Literal

import pandas as pd


class ExportService:
    """Export test cases to Excel, JSON, Markdown, CSV."""

    def to_excel(
        self,
        output_text: str,
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format']
    ) -> bytes:
        buf = BytesIO()
        if output_format != 'BDD (Gherkin)':
            df = self._parse_xray_to_dataframe(output_text)
        else:
            df = self._parse_gherkin_to_dataframe(output_text)
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Tests")
        buf.seek(0)
        return buf.read()

    def _parse_xray_to_dataframe(self, text: str) -> pd.DataFrame:
        lines = text.splitlines()
        rows = []
        current_summary = None
        in_table = False
        for ln in lines:
            stripped = ln.strip()
            if stripped.startswith("**Test Summary:**"):
                current_summary = stripped.split("**Test Summary:**", 1)[-1].strip().strip("* ")
                in_table = False
                continue
            if stripped.startswith("|") and ("Step" in stripped and "Expected" in stripped):
                in_table = True
                continue
            if in_table:
                if stripped.startswith("|"):
                    parts = [p.strip() for p in stripped.strip("|").split("|")]
                    if len(parts) >= 3 and not all(set(p) <= set('-: ') for p in parts):
                        rows.append({
                            "Test Summary": current_summary or "",
                            "Step": parts[0] if len(parts) > 0 else "",
                            "Test Data": parts[1] if len(parts) > 1 else "",
                            "Expected Result": parts[2] if len(parts) > 2 else "",
                        })
                else:
                    in_table = False
        if rows:
            return pd.DataFrame(rows, columns=["Test Summary", "Step", "Test Data", "Expected Result"])
        return pd.DataFrame({"Jira Tests": [text]})

    def _parse_gherkin_to_dataframe(self, text: str) -> pd.DataFrame:
        lines = text.splitlines()
        rows = []
        current_scenario = None
        order = 0
        for ln in lines:
            s = ln.strip()
            if not s:
                continue
            if s.lower().startswith("scenario"):
                parts = s.split(":", 1)
                name = parts[1].strip() if len(parts) > 1 else ""
                current_scenario = name or parts[0].strip()
                order = 0
                continue
            tokens = ("Given", "When", "Then", "And", "But")
            for t in tokens:
                if s.startswith(t + " ") or s == t:
                    step_text = s[len(t):].strip()
                    order += 1
                    rows.append({
                        "Scenario": current_scenario or "",
                        "Step #": order,
                        "Step Type": t,
                        "Step": step_text,
                    })
                    break
        if rows:
            return pd.DataFrame(rows, columns=["Scenario", "Step #", "Step Type", "Step"])
        return pd.DataFrame({"Gherkin": [text]})

    def to_json(self, test_cases: List[Dict[str, Any]], indent: int = 2) -> str:
        return json.dumps(test_cases, indent=indent, ensure_ascii=False)

    def to_json_bytes(self, test_cases: List[Dict[str, Any]], indent: int = 2) -> bytes:
        return self.to_json(test_cases, indent).encode("utf-8")

    def to_markdown(
        self,
        test_cases: List[Dict[str, Any]],
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format'],
        separator: str = "\n\n---\n\n"
    ) -> str:
        return separator.join(tc['content'] for tc in test_cases)

    def to_markdown_bytes(
        self,
        test_cases: List[Dict[str, Any]],
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format'],
        separator: str = "\n\n---\n\n"
    ) -> bytes:
        return self.to_markdown(test_cases, output_format, separator).encode("utf-8")

    def to_csv(
        self,
        output_text: str,
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format']
    ) -> bytes:
        buf = BytesIO()
        if output_format != 'BDD (Gherkin)':
            df = self._parse_xray_to_dataframe(output_text)
        else:
            df = self._parse_gherkin_to_dataframe(output_text)
        df.to_csv(buf, index=False, encoding='utf-8')
        buf.seek(0)
        return buf.read()

    def sources_to_json(self, sources: List[Dict[str, Any]], indent: int = 2) -> bytes:
        return json.dumps(sources, indent=indent, ensure_ascii=False).encode("utf-8")

    @staticmethod
    def get_file_extension(
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format'],
        export_type: Literal['excel', 'json', 'markdown', 'csv']
    ) -> str:
        extensions = {
            'excel': '.xlsx',
            'json': '.json',
            'csv': '.csv',
            'markdown': '.feature' if output_format == 'BDD (Gherkin)' else '.md'
        }
        return extensions.get(export_type, '.txt')

    @staticmethod
    def get_mime_type(export_type: Literal['excel', 'json', 'markdown', 'csv']) -> str:
        mime_types = {
            'excel': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'json': 'application/json',
            'markdown': 'text/markdown',
            'csv': 'text/csv'
        }
        return mime_types.get(export_type, 'text/plain')
