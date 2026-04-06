"""
Test Case Parser Module

This module provides parsing capabilities for test cases in various formats,
including BDD (Gherkin) and Xray Jira Test Format.

The TestCaseParser class handles:
- Parsing generated test case text into structured objects
- Splitting Xray-formatted test cases
- Parsing BDD/Gherkin scenarios
- Normalizing test case IDs and indices

Classes:
    - TestCaseParser: Main service class for test case parsing

Supported Formats:
    - BDD (Gherkin): Feature/Scenario/Given/When/Then format
    - Xray Jira Test Format: Markdown tables with Test Summary and Steps

Example Usage:
    ```python
    from app.services.test_case_parser import TestCaseParser
    
    parser = TestCaseParser()
    
    # Parse BDD test cases
    bdd_cases = parser.parse("Feature: Login\\nScenario: ...", "BDD (Gherkin)")
    
    # Parse Xray test cases
    xray_cases = parser.parse("**Test Case 1:**\\n...", "Xray Jira Test Format")
    
    # Normalize IDs after modifications
    normalized = parser.normalize_and_reindex(test_cases, "Xray Jira Test Format")
    ```
"""

import re
from typing import List, Dict, Any, Tuple, Literal, Optional


class TestCaseParser:
    """
    Service class for parsing test cases from various formats.
    
    This class provides methods to:
    - Parse BDD/Gherkin formatted test cases
    - Parse Xray Jira formatted test cases
    - Split and extract individual test cases
    - Normalize test case numbering and IDs
    """
    
    # Regex patterns for parsing
    XRAY_HEADER_PATTERN = re.compile(
        r"(?m)^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*Test\s*Case\s*(\d+)\s*:\s*(.*?)\s*(?:\*\*)?\s*$"
    )
    XRAY_WEAK_PATTERN = re.compile(
        r"(?m)^\s*Test\s*Case\s*(\d+)\s*:\s*(.*)$"
    )
    # Match "Scenario Outline" before "Scenario" so both split into separate test cases
    GHERKIN_SPLIT_PATTERN = re.compile(
        r'\n\s*(Feature|Scenario\s+Outline|Scenario):\s*',
        re.IGNORECASE
    )
    # Section at end of LLM output: CONFIDENCE_SCORES: then "1: N (reason)" per line.
    # LLMs may wrap the header in bold (**), headings (##), or use a space instead of underscore.
    CONFIDENCE_SECTION_MARKER = re.compile(
        r'(?m)^\s*(?:#{1,6}\s*)?\*{0,2}\s*CONFIDENCE[_\s]SCORES\s*:?\s*\*{0,2}\s*:?\s*$',
        re.IGNORECASE,
    )
    CONFIDENCE_LINE_PATTERN = re.compile(
        r'^\s*\*{0,2}\s*(\d+)\s*\*{0,2}\s*:\s*(\d)\s*(?:\(([^)]*)\))?\s*$',
        re.MULTILINE,
    )
    DEFAULT_CONFIDENCE = 3
    # Strip leading "23. " or "25) " from titles so the UI shows "Empty or null..." not "25. Empty or null..."
    _TITLE_NUMBER_PATTERN = re.compile(r'^\s*\d+[\s.)]\s*', re.IGNORECASE)
    # LLM outline junk after real Gherkin: "1.\n  a. Next scenario title" or "1. a. Next title" (no Scenario:)
    _NUMBERED_OUTLINE_ONE_LINE = re.compile(
        r'^\s*\d+\.\s*[a-zA-Z]\.\s+(.+)$'
    )
    _NUMBERED_OUTLINE_NUM_ONLY = re.compile(r'^\s*\d+\.\s*$')
    _NUMBERED_OUTLINE_LETTER_LINE = re.compile(
        r'^\s*[a-z]\.\s+(\S.+)$', re.IGNORECASE
    )
    _TC_TAG_PATTERN = re.compile(r'\s*@TC[-_]\d+', re.IGNORECASE)

    @staticmethod
    def _strip_leading_number(title: str) -> str:
        """Remove leading number prefix from title (e.g. '25. Empty or null...' -> 'Empty or null...')."""
        if not title or not isinstance(title, str):
            return title or ""
        return TestCaseParser._TITLE_NUMBER_PATTERN.sub('', title).strip() or title

    @staticmethod
    def _extract_confidence_section(raw_text: str) -> Tuple[str, List[Tuple[int, Optional[str]]]]:
        """
        Extract CONFIDENCE_SCORES section from end of raw text; return text without it and list of (score, reason) by order.
        """
        scores_list: List[Tuple[int, Optional[str]]] = []
        match = TestCaseParser.CONFIDENCE_SECTION_MARKER.search(raw_text)
        if not match:
            return raw_text, scores_list
        section_start = match.start()
        main_text = raw_text[:section_start].rstrip()
        section_text = raw_text[match.end():].lstrip()
        for line in section_text.splitlines():
            line = line.strip()
            if not line or line == '---':
                continue
            cleaned = re.sub(r'\*{1,2}', '', line).strip()
            m = TestCaseParser.CONFIDENCE_LINE_PATTERN.match(cleaned)
            if m:
                score = int(m.group(2))
                if score < 1:
                    score = 1
                elif score > 5:
                    score = 5
                reason = (m.group(3) or "").strip() or None
                scores_list.append((score, reason))
        return main_text, scores_list

    def _inject_scenario_before_numbered_outlines(self, text: str) -> str:
        """
        Turn LLM numbered outline fragments (without Scenario:) into real Scenario lines
        so GHERKIN_SPLIT_PATTERN produces separate test cases instead of appending junk
        to the previous scenario's content (e.g. Xray Description).
        """
        lines = text.split('\n')
        out: List[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            m_one = self._NUMBERED_OUTLINE_ONE_LINE.match(line.rstrip())
            if m_one:
                title = m_one.group(1).strip()
                if title and not re.match(
                    r'^(Given|When|Then|And|But)\b', title, re.IGNORECASE
                ):
                    out.append('')
                    out.append(f'Scenario: {title}')
                    i += 1
                    continue
            if self._NUMBERED_OUTLINE_NUM_ONLY.match(line.rstrip()) and i + 1 < len(
                lines
            ):
                m_sub = self._NUMBERED_OUTLINE_LETTER_LINE.match(lines[i + 1].rstrip())
                if m_sub:
                    title = m_sub.group(1).strip()
                    if title and not re.match(
                        r'^(Given|When|Then|And|But)\b', title, re.IGNORECASE
                    ):
                        out.append('')
                        out.append(f'Scenario: {title}')
                        i += 2
                        continue
            out.append(line)
            i += 1
        return '\n'.join(out)

    @staticmethod
    def _trim_trailing_outline_artifact(body_lines: List[str]) -> List[str]:
        """Drop lines from the first numbered outline fragment (same patterns as inject)."""
        for idx, line in enumerate(body_lines):
            s = line.rstrip()
            if TestCaseParser._NUMBERED_OUTLINE_ONE_LINE.match(s):
                return body_lines[:idx]
            if TestCaseParser._NUMBERED_OUTLINE_NUM_ONLY.match(s):
                if idx + 1 < len(body_lines):
                    nxt = body_lines[idx + 1].rstrip()
                    if TestCaseParser._NUMBERED_OUTLINE_LETTER_LINE.match(nxt):
                        return body_lines[:idx]
        return body_lines

    def _move_preamble_after_scenarios(self, text: str) -> str:
        """
        Pre-process: move @tag and # comment lines that sit between scenarios
        to immediately after the following Scenario/Scenario Outline keyword line.

        Feature: lines are "transparent" — any pending tags/comments pass through
        them so they ultimately attach to the next Scenario.
        Regular content lines flush the buffer in-place (they belong to the
        current scenario).
        """
        lines = text.split('\n')
        result: List[str] = []
        buffer: List[str] = []

        for line in lines:
            stripped = line.strip()
            is_meta = (
                not stripped
                or stripped.startswith('@')
                or stripped.startswith('#')
            )

            if is_meta:
                buffer.append(line)
            elif re.match(
                r'\s*(Scenario\s+Outline|Scenario)\s*:', stripped, re.IGNORECASE
            ):
                result.append(line)
                result.extend(buffer)
                buffer = []
            elif re.match(r'\s*Feature\s*:', stripped, re.IGNORECASE):
                result.append(line)
            else:
                result.extend(buffer)
                buffer = []
                result.append(line)

        result.extend(buffer)
        return '\n'.join(result)

    @staticmethod
    def _extract_preamble(
        body_lines: List[str],
    ) -> Tuple[List[str], List[str]]:
        """
        Split *body_lines* into (preamble, remaining) where *preamble* contains
        the leading @tag / # comment lines (moved here by preprocessing).

        @TC-NNN tags are stripped; empty tag lines are dropped.
        Leading/trailing blank lines in the preamble are discarded.
        """
        cut = 0
        for i, line in enumerate(body_lines):
            stripped = line.strip()
            if stripped and not stripped.startswith('@') and not stripped.startswith('#'):
                cut = i
                break
        else:
            cut = len(body_lines)

        raw_preamble = body_lines[:cut]
        remaining = body_lines[cut:]

        cleaned: List[str] = []
        for line in raw_preamble:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith('@'):
                cleaned_line = TestCaseParser._TC_TAG_PATTERN.sub('', stripped).strip()
                if cleaned_line:
                    cleaned.append(cleaned_line)
            else:
                cleaned.append(stripped)

        return cleaned, remaining

    @staticmethod
    def _trim_trailing_tags_and_comments(body_lines: List[str]) -> List[str]:
        """Drop trailing @tag, # comment, and blank lines that belong to the next test case."""
        result = list(body_lines)
        while result:
            stripped = result[-1].strip()
            if not stripped or stripped.startswith('@') or stripped.startswith('#'):
                result.pop()
            else:
                break
        return result

    def parse(
        self,
        test_cases_text: str,
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format']
    ) -> List[Dict[str, Any]]:
        """
        Parse generated test cases text into structured test case objects.
        
        Args:
            test_cases_text: Raw text containing generated test cases
            output_format: Format of the test cases ('BDD (Gherkin)' or 'Xray Jira Test Format')
            
        Returns:
            List of test case dictionaries with keys:
            - id: Unique identifier (e.g., "tc_1")
            - title: Test case title
            - content: Full test case content
            - jira_id: Jira issue ID (None initially)
            - status: Status string ("draft" initially)
            
        Example:
            ```python
            test_cases = parser.parse(generated_text, "BDD (Gherkin)")
            for tc in test_cases:
                print(f"Test Case: {tc['title']}")
                print(f"Content: {tc['content'][:100]}...")
            ```
        """
        main_text, confidence_scores = self._extract_confidence_section(test_cases_text)
        if output_format == 'BDD (Gherkin)':
            test_cases = self._parse_bdd_format(main_text)
        else:
            test_cases = self._parse_xray_format(main_text)
        for i, tc in enumerate(test_cases):
            if i < len(confidence_scores):
                score, reason = confidence_scores[i]
                tc['confidence'] = score
                tc['confidence_reason'] = reason
            else:
                tc.setdefault('confidence', TestCaseParser.DEFAULT_CONFIDENCE)
                tc.setdefault('confidence_reason', None)
        return test_cases
    
    # ==========================================================================
    # BDD/GHERKIN PARSING
    # ==========================================================================
    
    def _parse_bdd_format(self, text: str) -> List[Dict[str, Any]]:
        """
        Parse BDD/Gherkin formatted test cases.
        
        Args:
            text: Raw Gherkin text
            
        Returns:
            List of parsed test case dictionaries
        """
        test_cases = []
        
        # Clean up markdown code blocks if present
        cleaned_text = re.sub(r'```gherkin\s*\n', '', text)
        cleaned_text = re.sub(r'\n```', '', cleaned_text)
        
        # Normalize markdown-style headings to Gherkin keywords so splitting works
        cleaned_text = re.sub(r'\n#+\s*Feature\s*:\s*', r'\nFeature: ', cleaned_text, flags=re.IGNORECASE)
        cleaned_text = re.sub(r'\n#+\s*Scenario\s+Outline\s*:\s*', r'\nScenario Outline: ', cleaned_text, flags=re.IGNORECASE)
        cleaned_text = re.sub(r'\n#+\s*Scenario\s*:\s*', r'\nScenario: ', cleaned_text, flags=re.IGNORECASE)
        cleaned_text = re.sub(r'\n#+\s*Background\s*:\s*', r'\nBackground: ', cleaned_text, flags=re.IGNORECASE)
        # If text starts with markdown heading (e.g. "## Feature:"), normalize so split sees "\nFeature:"
        if re.match(r'^\s*#+\s*(Feature|Scenario|Background)\s*:', cleaned_text, re.IGNORECASE):
            cleaned_text = re.sub(r'^\s*#+\s*', '\n', cleaned_text, count=1)

        # LLMs often emit "Scenario 1:", "### Scenario 2:", "**Scenario 3:**" instead of "Scenario:".
        # The split pattern only recognizes "Scenario:" — normalize numbered variants first.
        cleaned_text = re.sub(
            r'(?m)^(?:\s*#+\s*|\s*\*{0,2}\s*)?Scenario\s+(?:Outline\s+)?\d+\s*:\s*(?:\*{0,2}\s*)?',
            '\nScenario: ',
            cleaned_text,
            flags=re.IGNORECASE,
        )
        # Same when the previous line ends and the next segment starts with optional spaces / bold.
        cleaned_text = re.sub(
            r'\n\s*(?:\*{0,2}\s*)?Scenario\s+(?:Outline\s+)?\d+\s*:\s*(?:\*{0,2}\s*)?',
            '\nScenario: ',
            cleaned_text,
            flags=re.IGNORECASE,
        )

        cleaned_text = self._inject_scenario_before_numbered_outlines(cleaned_text)

        cleaned_text = self._move_preamble_after_scenarios(cleaned_text)

        # Split regex requires a leading newline before "Feature:"; files often start with "Feature:".
        cleaned_text = cleaned_text.strip()
        if re.match(r'^(Feature|Scenario\s+Outline|Scenario|Background)\s*:', cleaned_text, re.IGNORECASE):
            cleaned_text = '\n' + cleaned_text

        # Split by Feature or Scenario keywords
        parts = self.GHERKIN_SPLIT_PATTERN.split(cleaned_text)
        
        current_feature = None
        scenario_counter = 1
        
        for i in range(1, len(parts), 2):
            keyword = parts[i]  # 'Feature' or 'Scenario'
            content = parts[i + 1] if i + 1 < len(parts) else ''
            
            if keyword == 'Feature':
                test_case = self._parse_feature(
                    content, current_feature, scenario_counter
                )
                if test_case:
                    current_feature = test_case.get('_feature_title')
                    if test_case.get('content'):
                        test_cases.append(test_case)
                        scenario_counter += 1
                else:
                    # Just extract feature title
                    lines = content.strip().split('\n')
                    current_feature = lines[0].strip() if lines else 'Untitled Feature'
                    
            elif keyword.strip().lower().startswith('scenario'):
                # "Scenario" or "Scenario Outline"
                test_case = self._parse_scenario(
                    content, current_feature, scenario_counter
                )
                test_cases.append(test_case)
                scenario_counter += 1
        
        # Fallback if no or very few test cases: try splitting by numbered headings (#1, ## 1., etc.)
        if len(test_cases) <= 1 and re.search(r'\n#+\s*\d+[\s.)]', cleaned_text):
            fallback = self._parse_numbered_headings(cleaned_text)
            if len(fallback) > len(test_cases):
                test_cases = fallback
        if not test_cases:
            test_cases = self._parse_bdd_fallback(cleaned_text)
        
        return test_cases
    
    def _parse_feature(
        self,
        content: str,
        current_feature: str,
        counter: int
    ) -> Dict[str, Any]:
        """Parse a Feature block from Gherkin text."""
        lines = content.strip().split('\n')
        raw = lines[0].strip() if lines else 'Untitled Feature'
        feature_title = self._strip_leading_number(raw) or raw

        trimmed = self._trim_trailing_tags_and_comments(lines[1:])
        remaining_content = '\n'.join(trimmed).strip()
        
        scenario_in_chunk = re.search(
            r'\n\s*Scenario(?:\s+Outline)?(?:\s+\d+)?\s*:',
            remaining_content,
            re.IGNORECASE,
        )
        # Scenarios often appear in later split segments (after Background / "## Happy Path" headings).
        # Do not emit one giant "feature" test case when this chunk only has preamble before those scenarios.
        if remaining_content and not scenario_in_chunk:
            has_background = bool(re.search(r'(?i)\bBackground\s*:', remaining_content))
            has_section_heading = bool(re.search(r'(?m)^\s*#+\s+\S', remaining_content))
            if has_background or has_section_heading:
                return {'_feature_title': feature_title}
            return {
                'id': f"tc_{counter}",
                'title': feature_title,
                'content': f"Feature: {feature_title}\n{remaining_content}",
                'jira_id': None,
                'status': 'draft',
                '_feature_title': feature_title
            }

        return {'_feature_title': feature_title}
    
    def _parse_scenario(
        self,
        content: str,
        current_feature: str,
        counter: int
    ) -> Dict[str, Any]:
        """Parse a Scenario block from Gherkin text."""
        lines = content.strip().split('\n')
        raw_title = lines[0].strip() if lines else f'Scenario {counter}'
        scenario_title = self._strip_leading_number(raw_title) or raw_title

        body_lines = lines[1:] if len(lines) > 1 else []
        body_lines = self._trim_trailing_outline_artifact(body_lines)
        body_lines = self._trim_trailing_tags_and_comments(body_lines)

        preamble, body_lines = self._extract_preamble(body_lines)

        full_content = ""
        if current_feature:
            full_content += f"Feature: {current_feature}\n\n"
        if preamble:
            full_content += '\n'.join(preamble) + '\n'
        full_content += f"Scenario: {scenario_title}"
        if body_lines:
            full_content += '\n' + '\n'.join(body_lines)

        return {
            'id': f"tc_{counter}",
            'title': scenario_title,
            'content': full_content,
            'jira_id': None,
            'status': 'draft',
        }
    
    def _parse_numbered_headings(self, text: str) -> List[Dict[str, Any]]:
        """Split by numbered headings like #1 Title, ## 1. Title, so each gets its own section."""
        test_cases = []
        # Split before lines that look like "#1 ", "## 2. ", "# 3) "
        parts = re.split(r'(?m)^(?:\s*#+\s*\d+[\s.)]\s*)', text)
        for i, block in enumerate(parts):
            block = block.strip()
            if not block or (i == 0 and not re.search(r'(Given|When|Then|Feature|Scenario)', block, re.I)):
                continue
            first_line = block.split('\n')[0].strip()
            title = self._strip_leading_number(first_line) or first_line
            title = title[:80] + ('...' if len(title) > 80 else '')
            test_cases.append({
                'id': f"tc_{len(test_cases) + 1}",
                'title': title,
                'content': block,
                'jira_id': None,
                'status': 'draft',
            })
        return test_cases

    def _parse_bdd_fallback(self, text: str) -> List[Dict[str, Any]]:
        """Fallback BDD parsing for non-standard formats."""
        test_cases = []
        blocks = text.split('\n\n')
        
        for i, block in enumerate(blocks):
            if not block.strip():
                continue
                
            # Check for Gherkin keywords
            has_gherkin = any(kw in block for kw in 
                           ['Given', 'When', 'Then', 'Feature:', 'Scenario:'])
            
            if has_gherkin:
                first_line = block.strip().split('\n')[0]
                if first_line.startswith(('Feature:', 'Scenario:')):
                    raw = first_line.split(':', 1)[1].strip() if ':' in first_line else f"Test Case {i+1}"
                    title = self._strip_leading_number(raw) or raw
                else:
                    title = f"Test Case {i+1}"
                test_cases.append({
                    'id': f"tc_{i+1}",
                    'title': title,
                    'content': block.strip(),
                    'jira_id': None,
                    'status': 'draft',
                })
        
        return test_cases
    
    # ==========================================================================
    # XRAY FORMAT PARSING
    # ==========================================================================
    
    def _parse_xray_format(self, text: str) -> List[Dict[str, Any]]:
        """
        Parse Xray Jira formatted test cases.
        
        Args:
            text: Raw Xray format text
            
        Returns:
            List of parsed test case dictionaries
        """
        split_cases = self.split_xray_test_cases(text)
        test_cases = []
        
        for i, (title, content) in enumerate(split_cases, start=1):
            clean_title = self._strip_leading_number(title).strip() if title else ""
            test_cases.append({
                'id': f"tc_{i}",
                'title': clean_title or title or f"Test Case {i}",
                'content': content.strip(),
                'jira_id': None,
                'status': 'draft',
            })
        
        return test_cases
    
    def split_xray_test_cases(self, text: str) -> List[Tuple[str, str]]:
        """
        Split Xray-style markdown content into individual (title, content) tuples.
        
        Handles variants like:
        - **Test Case 1:** Title...
        - **Test Case 1: Title...**
        - ## Test Case 1: Title
        
        Args:
            text: Raw Xray format text
            
        Returns:
            List of (title, content) tuples
        """
        # Normalize line endings
        s = text.replace('\r\n', '\n')
        
        # Try primary pattern first
        matches = list(self.XRAY_HEADER_PATTERN.finditer(s))
        
        # Fallback to weaker pattern
        if not matches:
            matches = list(self.XRAY_WEAK_PATTERN.finditer(s))
        
        # No headers found - treat whole text as one case
        if not matches:
            return self._handle_single_case(s)
        
        # Build slices between headers
        return self._extract_xray_blocks(s, matches)
    
    def _handle_single_case(self, text: str) -> List[Tuple[str, str]]:
        """Handle text with no clear test case headers."""
        lines = [ln for ln in text.split('\n') if ln.strip()]
        title = ""
        
        if lines:
            first = lines[0]
            if "Test Summary:" in first:
                title = first.split("Test Summary:", 1)[-1].strip().strip("* ")
            else:
                title = first.strip().strip("* ")
        
        return [(title, text.strip())]
    
    def _extract_xray_blocks(
        self,
        text: str,
        matches: List
    ) -> List[Tuple[str, str]]:
        """Extract individual test case blocks from matched headers."""
        results = []
        
        for idx, m in enumerate(matches):
            start = m.start()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
            block = text[start:end].strip()
            
            header_line = m.group(0)
            title = m.group(2).strip() if m.lastindex and m.lastindex >= 2 else ''
            title = self._strip_leading_number(title).strip() or title
            
            # Derive title if not in header
            if not title:
                title = self._derive_xray_title(block)
            
            # Check if block has substantive content
            if self._has_substantive_content(block, header_line):
                results.append((title, block))
        
        return results
    
    def _derive_xray_title(self, block: str) -> str:
        """Derive a title from an Xray test case block."""
        # Look for Test Summary first
        summary_match = re.search(r"\*\*Test Summary:\*\*\s*(.+)", block)
        if summary_match:
            raw = summary_match.group(1).strip()
            return self._strip_leading_number(raw) or raw
        
        # Use first non-header line
        lines = [ln for ln in block.split('\n') if ln.strip()]
        for ln in lines:
            if not re.search(r"^\s*(?:#{1,6}|\*\*|Test\s*Case\s*\d+\s*:)", ln, re.IGNORECASE):
                raw = ln.strip().strip('* ')
                return self._strip_leading_number(raw) or raw
        
        return ""
    
    def _has_substantive_content(self, block: str, header_line: str) -> bool:
        """Check if a block has meaningful content beyond the header."""
        body = block[len(header_line):].strip() if block.startswith(header_line) else block
        
        has_table = '| Step' in body or '|Step' in body or re.search(r"\|\s*\d+\.\s*", body)
        has_summary = '**Test Summary:**' in body
        has_min_len = len(body) >= 40
        
        return has_table or has_summary or has_min_len
    
    # ==========================================================================
    # UTILITY METHODS
    # ==========================================================================
    
    @staticmethod
    def normalize_and_reindex(
        test_cases: List[Dict[str, Any]],
        output_format: str
    ) -> List[Dict[str, Any]]:
        """
        Normalize numbering and IDs for test cases.
        
        This should be called after any modification to the test cases list
        to ensure consistent IDs.
        
        Args:
            test_cases: List of test case dictionaries
            output_format: Format of the test cases
            
        Returns:
            Same list with normalized IDs
        """
        for i, case in enumerate(test_cases):
            case['id'] = f"tc_{i+1}"
        return test_cases
    
    @staticmethod
    def _looks_truncated(
        content: str,
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format'],
    ) -> bool:
        """Heuristic: does a test case look like it was cut off mid-generation?"""
        text = (content or '').strip()
        if len(text) < 30:
            return True

        if output_format == 'Xray Jira Test Format':
            lines = text.split('\n')
            has_step_header = any(
                '|' in ln and re.search(r'Step', ln, re.IGNORECASE)
                for ln in lines
            )
            if has_step_header:
                data_rows = [
                    ln for ln in lines
                    if ln.strip().startswith('|')
                    and not re.match(r'^\s*\|[\s\-:|]+\|$', ln.strip())
                    and not re.search(r'\bStep\b', ln, re.IGNORECASE)
                ]
                if not data_rows:
                    return True
        else:
            has_scenario = bool(re.search(r'\bScenario\b', text, re.IGNORECASE))
            has_then = bool(re.search(r'\bThen\b', text, re.IGNORECASE))
            if has_scenario and not has_then:
                return True

        return False

    @classmethod
    def drop_truncated_tail(
        cls,
        test_cases: List[Dict[str, Any]],
        output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format'],
    ) -> List[Dict[str, Any]]:
        """
        If the last test case looks like it was cut off by the LLM token limit,
        remove it and re-index so the user never sees broken content.

        Only acts when there are 2+ test cases (always keeps at least one).
        """
        if len(test_cases) < 2:
            return test_cases
        last = test_cases[-1]
        if cls._looks_truncated(last.get('content', ''), output_format):
            test_cases = test_cases[:-1]
            cls.normalize_and_reindex(test_cases, output_format)
        return test_cases

    @staticmethod
    def create_test_case(
        index: int,
        title: str,
        content: str,
        jira_id: str = None,
        status: str = 'draft',
        confidence: Optional[int] = None,
        confidence_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a test case dictionary with standard structure.
        
        Args:
            index: Index number for the test case
            title: Test case title
            content: Test case content
            jira_id: Optional Jira issue ID
            status: Status string (default: 'draft')
            confidence: Optional confidence score 1-5 (default: 3)
            confidence_reason: Optional reason for the score
            
        Returns:
            Test case dictionary
        """
        if confidence is None:
            confidence = TestCaseParser.DEFAULT_CONFIDENCE
        return {
            'id': f"tc_{index}",
            'title': title,
            'content': content,
            'jira_id': jira_id,
            'status': status,
            'confidence': confidence,
            'confidence_reason': confidence_reason,
        }
