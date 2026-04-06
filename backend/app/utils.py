"""Backward compatibility: build_excel_from_output."""
from app.export.export_service import ExportService

_exporter = ExportService()


def build_excel_from_output(output_text: str, output_format: str) -> bytes:
    return _exporter.to_excel(output_text, output_format)
