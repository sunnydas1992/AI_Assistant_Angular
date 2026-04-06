"""Regression: BDD parser must not merge LLM outline fragments into prior scenario content."""

import pytest

from app.services.test_case_parser import TestCaseParser


@pytest.fixture
def parser() -> TestCaseParser:
    return TestCaseParser()


def test_two_line_numbered_outline_splits_second_scenario(parser: TestCaseParser) -> None:
    raw = """Feature: Crypto

Scenario: First case
  Given a cipher
  When I encrypt
  Then I get ciphertext

1.
  a. Encrypt and decrypt empty string
  Given empty input
  When I encrypt
  Then result is empty
"""
    cases = parser.parse(raw, "BDD (Gherkin)")
    assert len(cases) >= 2
    first = next(c for c in cases if c["title"] == "First case")
    assert "1." not in first["content"]
    assert "a. Encrypt and decrypt empty string" not in first["content"]
    second = next(c for c in cases if "empty string" in c["title"].lower())
    assert "Given empty input" in second["content"]


def test_single_line_numbered_outline_splits(parser: TestCaseParser) -> None:
    raw = """Feature: X

Scenario: Alpha
  Given x
  Then y

1. b. Beta scenario title
  Given b
  Then c
"""
    cases = parser.parse(raw, "BDD (Gherkin)")
    assert len(cases) >= 2
    alpha = next(c for c in cases if c["title"] == "Alpha")
    assert "1. b." not in alpha["content"]
    beta = next(c for c in cases if "Beta scenario" in c["title"])
    assert "Given b" in beta["content"]


def test_trim_when_inject_skips_given_prefixed_outline(parser: TestCaseParser) -> None:
    """Inject skips letter lines that look like steps; trim still drops the outline block."""
    raw = """Feature: Z

Scenario: Only
  Given one
  Then two

1.
  a. Given this is junk not a new scenario
"""
    cases = parser.parse(raw, "BDD (Gherkin)")
    assert len(cases) == 1
    only = cases[0]
    assert only["title"] == "Only"
    assert "1." not in only["content"]
    assert "Given this is junk" not in only["content"]
    assert "Given one" in only["content"]
