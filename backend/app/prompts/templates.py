"""
Prompt Templates Module - Centralized LLM prompt templates.
"""

from typing import Literal


class PromptTemplates:
    """Centralized container for all LLM prompt templates."""

    BASE_TEST_CASE_PROMPT = """
You are an expert QA Engineer. Your primary task is to write detailed, clear, and comprehensive test cases based on a Jira ticket and its related documentation.
Ensure you provide maximum test coverage by including positive scenarios, negative scenarios, and critical edge cases.
Use the provided context from similar Jira tickets, Confluence pages, and uploaded documentation to understand the requirements fully.
Follow these constraints: avoid duplicate scenarios, make steps granular and observable, clearly state expected results, and group by Happy Path, Negative, and Edge cases where applicable.

CONTEXT FROM KNOWLEDGE BASE:
{context}

ADDITIONAL INSTRUCTIONS FROM USER (follow these when generating; if "None", ignore):
{user_instructions}

REQUIREMENT SOURCE (Jira ticket or Confluence page):
{jira_ticket}
"""

    BDD_INSTRUCTIONS = """
Based on all the provided information, write the test cases in BDD Gherkin format.

OUTPUT (in Gherkin format only). After all test cases, add a separate section on its own line(s):

CONFIDENCE_SCORES:
1: N (brief reason)
2: N (brief reason)
...

where each line is the test case number (in order), N is 1-5 (1=low relevance/accuracy, 5=high), and reason is optional. Use 5 when the test case directly maps to ticket requirements; use 1-2 when inferred or speculative.
"""

    XRAY_INSTRUCTIONS = """
Based on all the provided information, write multiple distinct manual test cases in a format suitable for Xray in Jira.
For each test case, provide a 'Test Summary' and a table of steps with 'Step', 'Test Data', and 'Expected Result'.
Do NOT include "Test Case N:" numbering in the output. Separate each test case with a line containing only "---".

OUTPUT (in structured markdown format). After all test cases, add a separate section:

CONFIDENCE_SCORES:
1: N (brief reason)
2: N (brief reason)
...

where each line is the test case number (in order), N is 1-5 (1=low relevance/accuracy to the ticket, 5=high), and reason is optional.

Example test case format:

**Test Summary:** Verify user can successfully log in with valid credentials.
**Steps:**
| Step | Test Data | Expected Result |
|---|---|---|
| 1. Navigate to the login page. | URL: /login | The login page is displayed. |
| 2. Enter a valid username and password. | Username: valid_user, Password: valid_password | User is logged in and redirected. |

---

**Test Summary:** Verify user cannot log in with invalid credentials.
**Steps:**
| Step | Test Data | Expected Result |
|---|---|---|
| 1. Navigate to the login page. | URL: /login | The login page is displayed. |
| 2. Enter an invalid password. | Username: valid_user, Password: wrong | An error message is displayed. |
"""

    SINGLE_TEST_CASE_REFINEMENT = """
You are an expert QA Engineer. Refine the following test case based on the user's feedback.
Maintain the original format and structure while incorporating the requested changes.
IMPORTANT: Return exactly ONE test case. Do not merge multiple test cases into one, and do not create new separate test cases.
Do NOT include "Test Case N:" numbering in the output.
For Xray format, update the **Test Summary:** line to accurately reflect the refined scenario.
For BDD format, update the Scenario title to reflect the refined scenario.

After the refined test case, add on a new line:

CONFIDENCE: N (brief reason)

where N is 1-5 (1=low relevance/quality, 5=high) reflecting how well the refined test case covers its intended scenario.

CURRENT TEST CASE:
{test_case}

USER FEEDBACK:
{feedback}
"""

    QUALITY_REVIEW_TEMPLATE = """You are a senior QA reviewer. Evaluate the following test case on four dimensions.
For each dimension, assign a score from 1 (poor) to 5 (excellent) and give a brief one-sentence justification.
Then compute an overall score as the average rounded to the nearest integer.

DIMENSIONS:
- clarity: Are the steps unambiguous, specific, and easy for any tester to follow?
- completeness: Does it cover all relevant scenarios implied by the title and steps (happy path, negative, boundary)?
- edge_cases: Does it address boundary values, error conditions, and unusual inputs?
- structure: Is the formatting consistent, well-organized, and following the expected output format?

TEST CASE TITLE: {title}
TEST CASE CONTENT:
{content}
OUTPUT FORMAT: {output_format}

Respond ONLY with valid JSON (no markdown fences) in this exact structure:
{{"overall":N,"clarity":{{"score":N,"reason":"..."}},"completeness":{{"score":N,"reason":"..."}},"edge_cases":{{"score":N,"reason":"..."}},"structure":{{"score":N,"reason":"..."}}}}
"""

    BULK_TEST_CASE_REFINEMENT_SYSTEM = (
        "You are a meticulous QA assistant. Apply the user's feedback to revise the given test cases. "
        "Only modify, add, or remove content as requested. Preserve the requested output format exactly. "
        "Ensure clarity, deduplication, and comprehensive coverage where requested.\n\n"
        "After all refined test cases, add a separate section on its own line(s):\n\n"
        "CONFIDENCE_SCORES:\n"
        "1: N (brief reason)\n"
        "2: N (brief reason)\n"
        "...\n\n"
        "where each line is the test case number (in order), N is 1-5 (1=low relevance/quality, 5=high), "
        "and reason is optional."
    )
    BDD_FORMAT_GUARD = (
        "Output MUST be valid Gherkin only (no extra commentary). "
        "Use Scenario, Given/When/Then/And with clear steps."
    )
    XRAY_FORMAT_GUARD = (
        "Output MUST be in the described Xray Jira format ONLY: For each test case, include a bold 'Test Summary' line "
        "and a markdown table with columns Step | Test Data | Expected Result."
    )
    BULK_REFINEMENT_TEMPLATE = (
        "{system}\n\nCurrent Output:\n\n{current}\n\nUser Feedback:\n\n{feedback}\n\nConstraints:\n{guard}\n"
    )

    TEST_PLAN_BASE = (
        "You are a senior QA Lead. Create a comprehensive, actionable Test Plan for the given initiative. "
        "Focus on scope, objectives, in/out of scope, test strategy (levels/types), environments, data, risks, "
        "entry/exit criteria, timelines, ownership, and reporting. "
        "Ensure clarity, non-duplication, and professional tone. Where appropriate, include bullet lists and tables for readability.\n\n"
        "Context from the knowledge base (Jira tickets, Confluence docs, uploads):\n{context}\n\n"
        "User-specific requirements: {user_requirements}\n\n"
        "{style_hint}\n"
    )
    TEST_PLAN_REFINEMENT_SYSTEM = (
        "You are a meticulous QA Lead. Revise the Test Plan strictly according to the user's feedback. "
        "Preserve professional formatting and improve clarity, structure, and completeness where requested."
    )
    TEST_PLAN_REFINEMENT_TEMPLATE = "{system}\n\nCurrent Test Plan:\n\n{current}\n\nUser Feedback:\n\n{feedback}\n"

    @classmethod
    def get_test_case_prompt(cls, output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format']) -> str:
        instructions = cls.BDD_INSTRUCTIONS if output_format == 'BDD (Gherkin)' else cls.XRAY_INSTRUCTIONS
        return cls.BASE_TEST_CASE_PROMPT + instructions


    @classmethod
    def get_format_guard(cls, output_format: Literal['BDD (Gherkin)', 'Xray Jira Test Format']) -> str:
        return cls.BDD_FORMAT_GUARD if output_format == 'BDD (Gherkin)' else cls.XRAY_FORMAT_GUARD

    @classmethod
    def get_test_plan_prompt(cls, style_hint: str = "") -> str:
        return cls.TEST_PLAN_BASE.replace("{style_hint}", style_hint)

    @classmethod
    def get_style_hint_from_title(cls, title: str) -> str:
        if title:
            return f"Follow the structure and sectioning style used in the sample Confluence page titled '{title}'. Do not copy text; adapt structure only."
        return "Follow the structure of the referenced sample Confluence page. Do not copy text; adapt structure only."
