"""
Logging configuration for QA Assistant backend.
Configures file and console handlers so events can be inspected for debugging.
Includes a redaction filter to prevent accidental credential leaks.
"""

import logging
import os
import re


_SENSITIVE_PATTERNS = re.compile(
    r"(?i)"
    r"(api[_-]?token|api[_-]?key|password|secret|authorization|bearer|access[_-]?token)"
    r"\s*[=:]\s*\S(?:[^\s,;|]*\s?){0,3}\S*",
)


class RedactingFilter(logging.Filter):
    """Replace sensitive-looking key=value pairs in log messages with redacted placeholders."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _SENSITIVE_PATTERNS.sub(
                lambda m: m.group(1) + "=***REDACTED***", record.msg
            )
        if record.args:
            new_args = []
            for a in (record.args if isinstance(record.args, tuple) else (record.args,)):
                if isinstance(a, str):
                    a = _SENSITIVE_PATTERNS.sub(
                        lambda m: m.group(1) + "=***REDACTED***", a
                    )
                new_args.append(a)
            record.args = tuple(new_args)
        return True


def setup_logging(log_dir: str = None, log_level: str = "INFO") -> None:
    """
    Configure application logging: one log file (rotating by day optional) and console.
    Call once at application startup (e.g. in lifespan).
    """
    if log_dir is None:
        log_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "qa_assistant.log")

    level = getattr(logging, log_level.upper(), logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    redact_filter = RedactingFilter()

    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        root.removeHandler(h)

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(level)
    fh.setFormatter(formatter)
    fh.addFilter(redact_filter)
    root.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setLevel(level)
    ch.setFormatter(formatter)
    ch.addFilter(redact_filter)
    root.addHandler(ch)

    # Reduce noise from third-party libs
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)

    logger = logging.getLogger("qa_assistant")
    logger.info("Logging initialized; log file: %s", log_file)
