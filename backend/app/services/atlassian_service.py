"""
Atlassian Service - Jira and Confluence operations.
"""

import json
import logging
import re
from typing import Dict, Any, List, Optional, Tuple

import requests
from jira import JIRA
from atlassian import Confluence
from bs4 import BeautifulSoup
import markdown as md

from app.config.settings import AtlassianConfig
from app.services.xray_duplicate import (
    escape_jql_string,
    extract_xray_comparable_summary,
    find_semantic_match,
    normalize_xray_summary_for_match,
    pick_jql_summary_token,
    tiebreak_duplicate_issues,
)
from app.services.xray_manual_fields import (
    effective_xray_publish_format,
    parse_xray_manual_content,
)

logger = logging.getLogger(__name__)


class AtlassianService:
    """Service for Jira and Confluence API operations."""

    def __init__(self, config: AtlassianConfig):
        self.config = config
        self.jira_client: Optional[JIRA] = None
        self.confluence_client: Optional[Confluence] = None
        self._initialize_clients()

    def _initialize_clients(self) -> None:
        if not self.config.is_configured():
            return
        try:
            self.jira_client = JIRA(
                server=self.config.server_url,
                basic_auth=(self.config.username, self.config.api_token)
            )
            self.confluence_client = Confluence(
                url=self.config.server_url,
                username=self.config.username,
                password=self.config.api_token
            )
        except Exception as e:
            logger.warning("Atlassian clients init failed: %s", e)
            self.jira_client = None
            self.confluence_client = None

    @property
    def is_jira_connected(self) -> bool:
        return self.jira_client is not None

    @property
    def is_confluence_connected(self) -> bool:
        return self.confluence_client is not None

    def get_jira_ticket_details(self, ticket_id: str) -> Optional[Dict[str, Any]]:
        if not self.jira_client:
            return None
        try:
            issue = self.jira_client.issue(ticket_id)
            content = self._format_jira_issue(issue, ticket_id)
            return {
                "text": content,
                "meta": {
                    "source_type": "jira",
                    "title": issue.fields.summary,
                    "url": f"/browse/{ticket_id}",
                    "ticket_key": ticket_id
                }
            }
        except Exception:
            return None

    @staticmethod
    def _jira_wiki_to_html(text: str) -> str:
        """Convert Jira wiki markup to basic HTML for display."""
        if not text:
            return ""
        import html as html_mod
        t = html_mod.escape(text)

        t = re.sub(r'\{color(?::[^}]*)?\}', '', t)
        t = re.sub(r'\{quote\}', '<blockquote>', t, count=1)
        t = re.sub(r'\{quote\}', '</blockquote>', t, count=1)
        t = re.sub(r'\{quote\}', '', t)
        t = re.sub(r'\{noformat\}([\s\S]*?)\{noformat\}', r'<pre>\1</pre>', t)
        t = re.sub(r'\{code(?::[^}]*)?\}([\s\S]*?)\{code\}', r'<pre><code>\1</code></pre>', t)

        t = re.sub(r'(?<!\w)\*([^*\n]+?)\*(?!\w)', r'<strong>\1</strong>', t)
        t = re.sub(r'(?<!\w)_([^_\n]+?)_(?!\w)', r'<em>\1</em>', t)
        t = re.sub(r'(?<!\w)\+([^+\n]+?)\+(?!\w)', r'<u>\1</u>', t)
        t = re.sub(r'(?<!\w)-([^-\n]+?)-(?!\w)', r'<del>\1</del>', t)

        t = re.sub(r'\[([^|\]\n]+)\|([^\]\n]+)\]', r'<a href="\2" target="_blank" rel="noopener">\1</a>', t)
        t = re.sub(r'\[([^\]\n]+)\]', r'<a href="\1" target="_blank" rel="noopener">\1</a>', t)

        t = re.sub(r'^h([1-6])\.\s+(.+)$', r'<h\1>\2</h\1>', t, flags=re.MULTILINE)

        lines = t.split('\n')
        result: List[str] = []
        in_list = False
        for line in lines:
            bullet = re.match(r'^([*#])\s+(.*)', line)
            if bullet:
                if not in_list:
                    tag = 'ul' if bullet.group(1) == '*' else 'ol'
                    result.append(f'<{tag}>')
                    in_list = tag
                result.append(f'<li>{bullet.group(2)}</li>')
            else:
                if in_list:
                    result.append(f'</{in_list}>')
                    in_list = False
                result.append(line)
        if in_list:
            result.append(f'</{in_list}>')
        t = '\n'.join(result)

        t = re.sub(r'\n{2,}', '</p><p>', t)
        t = t.replace('\n', '<br>')
        t = f'<p>{t}</p>'
        t = t.replace('<p></p>', '')
        return t

    def get_jira_ticket_structured(self, ticket_id: str) -> Optional[Dict[str, Any]]:
        """Return structured Jira fields as a dict (for UI display, not RAG ingestion).

        Attempts to use Jira's renderedFields (pre-rendered HTML) first; falls
        back to converting raw wiki markup via ``_jira_wiki_to_html``.
        """
        if not self.jira_client:
            return None
        try:
            issue = self.jira_client.issue(ticket_id, expand='renderedFields')
            f = issue.fields
            rf = getattr(issue, 'renderedFields', None)

            def _rendered(field_name: str, raw_value: str) -> str:
                """Return rendered HTML if available, else convert wiki markup."""
                rendered = getattr(rf, field_name, None) if rf else None
                if rendered and rendered.strip():
                    return rendered
                return self._jira_wiki_to_html(raw_value) if raw_value else ""

            raw_desc = f.description or ""
            raw_env = (f.environment or "") if hasattr(f, "environment") else ""

            result: Dict[str, Any] = {
                "ticket_id": ticket_id,
                "summary": f.summary or "",
                "issue_type": f.issuetype.name if hasattr(f, "issuetype") and f.issuetype else "",
                "status": f.status.name if hasattr(f, "status") and f.status else "",
                "priority": f.priority.name if hasattr(f, "priority") and f.priority else "",
                "labels": list(f.labels) if hasattr(f, "labels") and f.labels else [],
                "components": [c.name for c in f.components] if hasattr(f, "components") and f.components else [],
                "assignee": f.assignee.displayName if hasattr(f, "assignee") and f.assignee else "",
                "reporter": f.reporter.displayName if hasattr(f, "reporter") and f.reporter else "",
                "description": _rendered("description", raw_desc),
                "acceptance_criteria": "",
                "steps_to_reproduce": "",
                "environment": _rendered("environment", raw_env),
                "url": f"/browse/{ticket_id}",
            }
            ac_field = self.config.acceptance_criteria_field
            if hasattr(f, ac_field) and getattr(f, ac_field):
                raw_ac = getattr(f, ac_field)
                result["acceptance_criteria"] = _rendered(ac_field, raw_ac)
            steps_field = self.config.steps_to_reproduce_field
            if hasattr(f, steps_field) and getattr(f, steps_field):
                raw_steps = getattr(f, steps_field)
                result["steps_to_reproduce"] = _rendered(steps_field, raw_steps)

            linked = []
            if hasattr(f, "issuelinks") and f.issuelinks:
                for link in f.issuelinks:
                    if hasattr(link, "outwardIssue"):
                        li = link.outwardIssue
                        linked.append({"relationship": link.type.outward, "key": li.key, "summary": li.fields.summary})
                    elif hasattr(link, "inwardIssue"):
                        li = link.inwardIssue
                        linked.append({"relationship": link.type.inward, "key": li.key, "summary": li.fields.summary})
            result["linked_issues"] = linked

            subtasks = []
            if hasattr(f, "subtasks") and f.subtasks:
                for st in f.subtasks:
                    status = st.fields.status.name if hasattr(st.fields, "status") else "Unknown"
                    subtasks.append({"key": st.key, "summary": st.fields.summary, "status": status})
            result["subtasks"] = subtasks

            attachments = []
            if hasattr(f, "attachment") and f.attachment:
                for att in f.attachment:
                    size_kb = att.size // 1024 if hasattr(att, "size") else 0
                    attachments.append({"filename": att.filename, "size_kb": size_kb})
            result["attachments"] = attachments

            comments = []
            if hasattr(f, "comment") and f.comment and f.comment.comments:
                rendered_comments = getattr(rf, 'comment', None) if rf else None
                rendered_map: Dict[str, str] = {}
                if rendered_comments and hasattr(rendered_comments, 'comments'):
                    for rc in rendered_comments.comments:
                        rendered_map[getattr(rc, 'id', '')] = getattr(rc, 'body', '')
                for c in f.comment.comments:
                    author = getattr(c.author, "displayName", "Unknown")
                    created = c.created[:10] if hasattr(c, "created") else ""
                    cid = getattr(c, 'id', '')
                    body_html = rendered_map.get(cid, '')
                    if not body_html.strip():
                        body_html = self._jira_wiki_to_html(c.body.strip())
                    comments.append({"author": author, "date": created, "body": body_html})
            result["comments"] = comments

            return result
        except Exception:
            return None

    def _format_jira_issue(self, issue, ticket_id: str) -> str:
        content = f"Source: Jira Ticket {ticket_id}\n{'='*60}\n"
        content += f"Issue Type: {issue.fields.issuetype.name}\n"
        content += f"Summary: {issue.fields.summary}\n"
        if hasattr(issue.fields, 'status') and issue.fields.status:
            content += f"Status: {issue.fields.status.name}\n"
        if hasattr(issue.fields, 'priority') and issue.fields.priority:
            content += f"Priority: {issue.fields.priority.name}\n"
        if hasattr(issue.fields, 'labels') and issue.fields.labels:
            content += f"Labels: {', '.join(issue.fields.labels)}\n"
        if hasattr(issue.fields, 'components') and issue.fields.components:
            content += f"Components: {', '.join(c.name for c in issue.fields.components)}\n"
        if hasattr(issue.fields, 'assignee') and issue.fields.assignee:
            content += f"Assignee: {issue.fields.assignee.displayName}\n"
        if hasattr(issue.fields, 'reporter') and issue.fields.reporter:
            content += f"Reporter: {issue.fields.reporter.displayName}\n"
        content += "\n"
        if getattr(issue.fields, 'description', None):
            content += f"DESCRIPTION:\n{'-'*40}\n{issue.fields.description}\n\n"
        ac_field = self.config.acceptance_criteria_field
        if hasattr(issue.fields, ac_field) and getattr(issue.fields, ac_field):
            content += f"ACCEPTANCE CRITERIA:\n{'-'*40}\n{getattr(issue.fields, ac_field)}\n\n"
        steps_field = self.config.steps_to_reproduce_field
        if hasattr(issue.fields, steps_field) and getattr(issue.fields, steps_field):
            content += f"STEPS TO REPRODUCE:\n{'-'*40}\n{getattr(issue.fields, steps_field)}\n\n"
        if hasattr(issue.fields, 'environment') and issue.fields.environment:
            content += f"ENVIRONMENT:\n{'-'*40}\n{issue.fields.environment}\n\n"
        if hasattr(issue.fields, 'issuelinks') and issue.fields.issuelinks:
            content += "LINKED ISSUES:\n" + "-"*40 + "\n"
            for link in issue.fields.issuelinks:
                if hasattr(link, 'outwardIssue'):
                    linked = link.outwardIssue
                    content += f"- {link.type.outward}: {linked.key} - {linked.fields.summary}\n"
                elif hasattr(link, 'inwardIssue'):
                    linked = link.inwardIssue
                    content += f"- {link.type.inward}: {linked.key} - {linked.fields.summary}\n"
            content += "\n"
        if hasattr(issue.fields, 'subtasks') and issue.fields.subtasks:
            content += "SUBTASKS:\n" + "-"*40 + "\n"
            for subtask in issue.fields.subtasks:
                status = subtask.fields.status.name if hasattr(subtask.fields, 'status') else 'Unknown'
                content += f"- {subtask.key}: {subtask.fields.summary} [{status}]\n"
            content += "\n"
        if hasattr(issue.fields, 'attachment') and issue.fields.attachment:
            content += "ATTACHMENTS:\n" + "-"*40 + "\n"
            for att in issue.fields.attachment:
                size_kb = att.size // 1024 if hasattr(att, 'size') else 0
                content += f"- {att.filename} ({size_kb} KB)\n"
            content += "\n"
        if hasattr(issue.fields, 'comment') and issue.fields.comment and issue.fields.comment.comments:
            content += f"COMMENTS ({len(issue.fields.comment.comments)} total):\n{'-'*40}\n"
            for comment in issue.fields.comment.comments:
                author = getattr(comment.author, 'displayName', 'Unknown')
                created = comment.created[:10] if hasattr(comment, 'created') else ''
                content += f"\n[{created}] {author}:\n{comment.body.strip()}\n"
            content += "\n"
        return content

    def _xray_cloud_bearer_token(self) -> Optional[str]:
        cid = (self.config.xray_cloud_client_id or "").strip()
        sec = (self.config.xray_cloud_client_secret or "").strip()
        if not cid or not sec:
            return None
        base = (self.config.xray_cloud_base_url or "").rstrip("/")
        try:
            r = requests.post(
                f"{base}/api/v2/authenticate",
                json={"client_id": cid, "client_secret": sec},
                timeout=45,
            )
            if r.status_code != 200:
                logger.warning(
                    "Xray Cloud authenticate failed: %s %s",
                    r.status_code,
                    (r.text or "")[:200],
                )
                return None
            tok = r.text.strip()
            if tok.startswith('"') and tok.endswith('"'):
                tok = tok[1:-1]
            return tok or None
        except Exception as e:
            logger.warning("Xray Cloud authenticate error: %s", e)
            return None

    def _push_xray_cloud_graphql_steps(self, issue_key: str, step_rows: List[Dict[str, str]]) -> bool:
        """
        Xray Cloud: add manual steps via GraphQL addTestStep (issueId = Jira internal issue id).
        Raven REST on atlassian.net is usually unavailable; this is the supported path for Cloud.
        """
        token = self._xray_cloud_bearer_token()
        if not token or not self.jira_client:
            return False
        try:
            issue = self.jira_client.issue(issue_key, fields="id")
            jid = str(issue.id)
        except Exception as e:
            logger.warning("Xray GraphQL: could not resolve Jira id for %s: %s", issue_key, e)
            return False

        base = (self.config.xray_cloud_base_url or "").rstrip("/")
        url = f"{base}/api/v2/graphql"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        mutation = """mutation AddTestStep($issueId: String!, $action: String!, $data: String, $result: String!) {
  addTestStep(
    issueId: $issueId,
    step: { action: $action, data: $data, result: $result }
  ) {
    id
  }
}"""

        for idx, s in enumerate(step_rows):
            variables = {
                "issueId": jid,
                "action": ((s.get("action") or "").strip() or "(no action)")[:8000],
                "data": (s.get("data") or "").strip()[:8000],
                "result": ((s.get("result") or "").strip() or "(no expected result)")[:8000],
            }
            try:
                r = requests.post(
                    url,
                    headers=headers,
                    json={"query": mutation.strip(), "variables": variables},
                    timeout=60,
                )
            except Exception as e:
                logger.warning(
                    "Xray GraphQL request failed for %s step %s: %s",
                    issue_key,
                    idx + 1,
                    e,
                )
                return False
            if r.status_code != 200:
                logger.warning(
                    "Xray GraphQL HTTP %s for %s step %s: %s",
                    r.status_code,
                    issue_key,
                    idx + 1,
                    (r.text or "")[:600],
                )
                return False
            try:
                body = r.json()
            except Exception:
                logger.warning(
                    "Xray GraphQL non-JSON for %s: %s",
                    issue_key,
                    (r.text or "")[:400],
                )
                return False
            if body.get("errors"):
                logger.warning(
                    "Xray GraphQL errors for %s step %s: %s",
                    issue_key,
                    idx + 1,
                    json.dumps(body.get("errors"), default=str)[:800],
                )
                return False
            data = body.get("data") or {}
            step_out = data.get("addTestStep")
            if step_out is None:
                logger.warning(
                    "Xray GraphQL addTestStep returned null for %s step %s: %s",
                    issue_key,
                    idx + 1,
                    json.dumps(body, default=str)[:500],
                )
                return False
        return True

    def _push_xray_cloud_rest_import(self, issue_key: str, step_rows: List[Dict[str, str]]) -> bool:
        """Legacy REST import attempts (best-effort fallback if GraphQL is unavailable)."""
        token = self._xray_cloud_bearer_token()
        if not token:
            return False
        base = (self.config.xray_cloud_base_url or "").rstrip("/")
        hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        steps_payload = [
            {
                "action": (s.get("action") or "").strip(),
                "data": (s.get("data") or "").strip(),
                "result": (s.get("result") or "").strip(),
            }
            for s in step_rows
        ]
        bodies: List[Any] = [
            {"tests": [{"testIssueKey": issue_key, "steps": steps_payload}]},
            {"tests": [{"issueKey": issue_key, "steps": steps_payload}]},
        ]
        endpoints = [
            f"{base}/api/v2/import/test/bulk",
            f"{base}/api/v2/import/test",
        ]
        for ep in endpoints:
            for body in bodies:
                try:
                    r = requests.post(ep, headers=hdrs, json=body, timeout=60)
                    if r.status_code in (200, 201, 204):
                        return True
                    logger.debug(
                        "Xray Cloud REST import try %s -> %s %s",
                        ep,
                        r.status_code,
                        (r.text or "")[:300],
                    )
                except Exception as e:
                    logger.debug("Xray Cloud REST import error %s: %s", ep, e)
        return False

    def _push_xray_manual_steps_cloud(self, issue_key: str, step_rows: List[Dict[str, str]]) -> bool:
        if self._push_xray_cloud_graphql_steps(issue_key, step_rows):
            return True
        return self._push_xray_cloud_rest_import(issue_key, step_rows)

    def _push_xray_manual_steps_raven(self, issue_key: str, step_rows: List[Dict[str, str]]) -> Tuple[bool, str]:
        """Use Xray Server/DC Raven REST on the Jira base URL (same session as Jira)."""
        if not self.jira_client:
            return False, "no jira client"
        base = (self.config.server_url or "").rstrip("/")
        session = getattr(self.jira_client, "_session", None)
        if session is None:
            return False, "no jira session"
        step_objs = [
            {
                "action": (s.get("action") or "").strip(),
                "data": (s.get("data") or "").strip(),
                "result": (s.get("result") or "").strip(),
            }
            for s in step_rows
        ]
        add_alt = [
            {"action": s["action"], "data": s["data"], "expectedResult": s["result"]}
            for s in step_objs
        ]
        payloads: List[Dict[str, Any]] = [
            {"add": step_objs},
            {"steps": step_objs},
            {"add": add_alt},
        ]
        urls = [
            f"{base}/rest/raven/1.0/api/test/{issue_key}/step",
            f"{base}/rest/raven/2.0/api/test/{issue_key}/steps",
        ]
        try:
            jid = self.jira_client.issue(issue_key, fields="id").id
            urls.extend(
                [
                    f"{base}/rest/raven/1.0/api/test/{jid}/step",
                    f"{base}/rest/raven/2.0/api/test/{jid}/steps",
                ]
            )
        except Exception:
            pass
        last_hint = "no response"
        for url in urls:
            for body in payloads:
                try:
                    r = session.post(url, json=body, timeout=60)
                    if r.status_code in (200, 201, 204):
                        return True, ""
                    last_hint = f"POST {url} -> {r.status_code}: {(r.text or '')[:200]}"
                    if r.status_code == 405:
                        r2 = session.put(url, json=body, timeout=60)
                        if r2.status_code in (200, 201, 204):
                            return True, ""
                        last_hint = f"PUT {url} -> {r2.status_code}: {(r2.text or '')[:200]}"
                except Exception as e:
                    last_hint = f"{url}: {e}"
                    logger.debug("Raven step push %s: %s", url, e)
        return False, last_hint

    def _push_xray_manual_steps(self, issue_key: str, step_rows: List[Dict[str, str]]) -> bool:
        mode = (self.config.xray_step_push_mode or "auto").strip().lower()
        if mode == "off" or not step_rows:
            return True
        cloud_creds = bool(
            (self.config.xray_cloud_client_id or "").strip()
            and (self.config.xray_cloud_client_secret or "").strip()
        )

        if mode == "cloud":
            return self._push_xray_manual_steps_cloud(issue_key, step_rows)
        if mode == "server":
            ok, hint = self._push_xray_manual_steps_raven(issue_key, step_rows)
            if not ok and hint:
                logger.warning("Raven step push failed for %s: %s", issue_key, hint)
            return ok

        # auto: GraphQL first when API keys exist (Jira Cloud + Xray Cloud); Raven for Server/DC.
        if cloud_creds and self._push_xray_cloud_graphql_steps(issue_key, step_rows):
            return True
        ok_r, hint = self._push_xray_manual_steps_raven(issue_key, step_rows)
        if ok_r:
            return True
        if hint and "404" in hint:
            logger.debug("Raven unavailable (typical on atlassian.net): %s", hint[:300])
        elif hint:
            logger.warning("Raven step push failed for %s: %s", issue_key, hint[:400])
        if cloud_creds and self._push_xray_cloud_rest_import(issue_key, step_rows):
            return True
        return False

    def _jira_issue_type_payload(self) -> Dict[str, str]:
        tid = (self.config.xray_test_issue_type_id or "").strip()
        if tid:
            return {"id": tid}
        name = (self.config.xray_test_issue_type_name or "Test").strip() or "Test"
        return {"name": name}

    def _jql_issuetype_predicate(self) -> str:
        tid = (self.config.xray_test_issue_type_id or "").strip()
        if tid:
            if tid.isdigit():
                return f"issuetype = {tid}"
            return f'issuetype = "{escape_jql_string(tid)}"'
        it = escape_jql_string((self.config.xray_test_issue_type_name or "Test").strip() or "Test")
        return f'issuetype = "{it}"'

    def create_xray_test(
        self,
        test_case: Dict[str, Any],
        project_key: str,
        output_format: str = "Xray Jira Test Format",
    ) -> Optional[str]:
        if not self.jira_client:
            return None
        try:
            content = test_case["content"]
            eff = effective_xray_publish_format(content, output_format)
            summary = extract_xray_comparable_summary(test_case, eff)

            description = content
            steps_to_push: List[Dict[str, str]] = []
            is_xray_format = eff == "Xray Jira Test Format"
            if is_xray_format:
                parsed = parse_xray_manual_content(content)
                steps_to_push = parsed.steps
                if parsed.steps:
                    description = (parsed.summary_for_description or summary or "").strip()
                    if not description:
                        description = (summary or "").strip() or content[:4000]
                else:
                    description = content

            issue_dict = {
                "project": {"key": project_key},
                "summary": summary,
                "description": description,
                "issuetype": self._jira_issue_type_payload(),
            }
            new_issue = self.jira_client.create_issue(fields=issue_dict)
            key = new_issue.key

            if is_xray_format and steps_to_push:
                pushed = self._push_xray_manual_steps(key, steps_to_push)
                if not pushed:
                    has_cloud = bool(
                        (self.config.xray_cloud_client_id or "").strip()
                        and (self.config.xray_cloud_client_secret or "").strip()
                    )
                    logger.warning(
                        "Xray manual steps not applied for %s; restoring full generated text to Description. "
                        "Jira Cloud needs Xray Cloud API keys: set XRAY_CLOUD_CLIENT_ID and "
                        "XRAY_CLOUD_CLIENT_SECRET (Jira → Apps → Xray → Global Settings → API Keys). "
                        "If GraphQL returns errors, try XRAY_CLOUD_BASE_URL=https://us.xray.cloud.getxray.app "
                        "for US-hosted Xray. Cloud creds configured: %s",
                        key,
                        has_cloud,
                    )
                    try:
                        issue = self.jira_client.issue(key)
                        issue.update(fields={"description": content})
                    except Exception as ue:
                        logger.warning("Description fallback update failed for %s: %s", key, ue)

            return key
        except Exception as e:
            logger.exception("create_xray_test failed for project %s: %s", project_key, e)
            return None

    def find_existing_xray_test(
        self,
        project_key: str,
        test_case: Dict[str, Any],
        output_format: str,
        embed_fn=None,
    ) -> Dict[str, Any]:
        """
        Return a dict describing any existing duplicate Jira Test in the project.

        Matching strategy (applied in order):
        1. Exact normalized match (casefold + whitespace collapse).
        2. Semantic similarity via embeddings (if *embed_fn* is provided).

        Returns: ``{"key": str|None, "similarity": float|None, "match_type": "exact"|"semantic"|None}``
        """
        empty = {"key": None, "similarity": None, "match_type": None}
        if not self.jira_client:
            return empty
        pk = (project_key or "").strip().upper()
        if not pk:
            return empty
        eff = effective_xray_publish_format(test_case.get("content") or "", output_format)
        comparable = extract_xray_comparable_summary(test_case, eff)
        target_norm = normalize_xray_summary_for_match(comparable)
        if not target_norm:
            return empty
        token = pick_jql_summary_token(comparable)
        if not token:
            return empty
        esc_token = escape_jql_string(token)
        jql = f"project = {pk} AND {self._jql_issuetype_predicate()} AND summary ~ \"{esc_token}\""
        try:
            issues = self.jira_client.search_issues(jql, maxResults=50, fields="summary,created")
        except Exception as e:
            logger.warning("find_existing_xray_test JQL failed: %s", e)
            return empty

        # --- Pass 1: exact normalized match ---
        exact_matches: List[Any] = []
        for issue in issues:
            raw = getattr(issue.fields, "summary", None) or ""
            if normalize_xray_summary_for_match(raw) == target_norm:
                exact_matches.append(issue)
        if exact_matches:
            return {
                "key": tiebreak_duplicate_issues(exact_matches).key,
                "similarity": 1.0,
                "match_type": "exact",
            }

        # --- Pass 2: semantic similarity (if embedding function available) ---
        if embed_fn and issues:
            candidates = [
                (issue, getattr(issue.fields, "summary", None) or "")
                for issue in issues
            ]
            result = find_semantic_match(
                comparable, candidates, embed_fn,
            )
            if result:
                matched_issue, score = result
                return {
                    "key": matched_issue.key,
                    "similarity": score,
                    "match_type": "semantic",
                }

        return empty

    def check_xray_duplicates(
        self,
        project_key: str,
        test_cases: List[Dict[str, Any]],
        output_format: str,
        embed_fn=None,
    ) -> List[Dict[str, Any]]:
        """One result dict per input test case (same order)."""
        out: List[Dict[str, Any]] = []
        for tc in test_cases:
            eff = effective_xray_publish_format(tc.get("content") or "", output_format)
            summary_used = extract_xray_comparable_summary(tc, eff)
            match = self.find_existing_xray_test(project_key, tc, output_format, embed_fn=embed_fn)
            out.append(
                {
                    "id": tc.get("id"),
                    "is_duplicate": match["key"] is not None,
                    "existing_issue_key": match["key"],
                    "summary_used": summary_used,
                    "similarity": match["similarity"],
                    "match_type": match["match_type"],
                }
            )
        return out

    def bulk_create_xray_tests(
        self,
        test_cases: List[Dict[str, Any]],
        project_key: str,
        output_format: str = "Xray Jira Test Format",
        skip_if_duplicate: bool = False,
        embed_fn=None,
    ) -> Dict[str, Any]:
        """
        Returns ``created_keys``, ``skipped_duplicates``, and ``per_item``
        (one entry per input test case with status/key info for front-end mapping).
        """
        created_keys: List[str] = []
        skipped_duplicates: List[Dict[str, Any]] = []
        per_item: List[Dict[str, Any]] = []
        for idx, test_case in enumerate(test_cases):
            title = test_case.get("title") or ""
            tc_id = test_case.get("id") or ""
            if skip_if_duplicate:
                match = self.find_existing_xray_test(project_key, test_case, output_format, embed_fn=embed_fn)
                if match["key"]:
                    skipped_duplicates.append(
                        {
                            "existing_issue_key": match["key"],
                            "summary_used": extract_xray_comparable_summary(
                                test_case,
                                effective_xray_publish_format(
                                    test_case.get("content") or "", output_format
                                ),
                            ),
                            "similarity": match["similarity"],
                            "match_type": match["match_type"],
                        }
                    )
                    per_item.append({"index": idx, "id": tc_id, "title": title, "status": "skipped_duplicate", "existing_key": match["key"]})
                    continue
            issue_key = self.create_xray_test(test_case, project_key, output_format)
            if issue_key:
                created_keys.append(issue_key)
                per_item.append({"index": idx, "id": tc_id, "title": title, "status": "created", "created_key": issue_key})
            else:
                per_item.append({"index": idx, "id": tc_id, "title": title, "status": "failed"})
        return {"created_keys": created_keys, "skipped_duplicates": skipped_duplicates, "per_item": per_item}

    # ------------------------------------------------------------------
    # Similar-ticket discovery
    # ------------------------------------------------------------------

    # Candidate pool size fetched from Jira before similarity ranking
    _CANDIDATE_POOL_SIZE = 50
    _SIMILARITY_THRESHOLD = 0.35

    def find_similar_tickets(
        self,
        ticket_id: str,
        max_results: int = 10,
        embed_fn=None,
    ) -> Optional[Dict[str, Any]]:
        """Find Jira tickets similar to *ticket_id* using semantic similarity.

        1. Fetch the source ticket's summary and components.
        2. Pull a broad candidate pool from Jira via simple JQL (same project,
           same component, then widens to whole project).
        3. Compute cosine similarity between the source summary and every
           candidate summary using sentence embeddings.
        4. Return the top *max_results* ranked by similarity score.

        *embed_fn* must expose ``embed_documents(List[str]) -> List[List[float]]``.
        If unavailable, falls back to a basic JQL keyword search.

        Returns ``{"source": {...}, "similar_tickets": [...]}`` or *None*.
        """
        if not self.jira_client:
            return None

        project_key = ticket_id.split("-")[0] if "-" in ticket_id else ""
        if not project_key:
            return None

        try:
            source = self.jira_client.issue(
                ticket_id,
                fields="summary,components,labels",
            )
        except Exception:
            return None

        summary = getattr(source.fields, "summary", "") or ""
        components = [
            c.name for c in (getattr(source.fields, "components", None) or [])
        ]
        empty_result: Dict[str, Any] = {
            "source": {"key": ticket_id, "summary": summary},
            "similar_tickets": [],
        }
        if not summary.strip():
            return empty_result

        # --- Step 1: gather a broad candidate pool from Jira ---
        pool_size = self._CANDIDATE_POOL_SIZE
        base = f"project = {project_key} AND key != {ticket_id}"
        comp_clause = ""
        if components:
            comp_list = ", ".join(f'"{escape_jql_string(c)}"' for c in components)
            comp_clause = f" AND component in ({comp_list})"

        # Extract significant words for keyword-based candidate fetching
        kw_stop = {
            "a", "an", "the", "is", "are", "was", "were", "be", "been",
            "have", "has", "had", "do", "does", "did", "will", "would",
            "could", "should", "to", "of", "in", "for", "on", "with", "at",
            "by", "from", "as", "and", "but", "or", "not", "so", "if",
            "when", "it", "its", "this", "that", "we", "they", "our",
            "code", "change", "bug", "fix", "new", "add", "update",
        }
        kw_words = re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", summary)
        keywords = []
        kw_seen: set = set()
        for w in kw_words:
            low = w.lower()
            if low not in kw_stop and low not in kw_seen and len(w) > 2:
                kw_seen.add(low)
                keywords.append(w)
            if len(keywords) >= 5:
                break
        text_clause = ""
        if keywords:
            text_clause = " AND " + " AND ".join(
                f'summary ~ "{escape_jql_string(w)}"' for w in keywords[:3]
            )
            text_or_clause = " AND (" + " OR ".join(
                f'summary ~ "{escape_jql_string(w)}"' for w in keywords
            ) + ")"

        fields = "summary,status,resolution,assignee,updated,comment"
        candidates: Dict[str, Any] = {}  # key -> issue

        queries: List[Optional[str]] = [
            # --- Keyword-based queries (find older but relevant tickets) ---
            # All keywords in summary, same component
            f"{base}{comp_clause}{text_clause} ORDER BY updated DESC"
            if text_clause and comp_clause else None,
            # All keywords in summary, any component
            f"{base}{text_clause} ORDER BY updated DESC"
            if text_clause else None,
            # Any keyword in summary, same component
            f"{base}{comp_clause}{text_or_clause} ORDER BY updated DESC"
            if keywords and comp_clause else None,
            # Any keyword in summary, any component
            f"{base}{text_or_clause} ORDER BY updated DESC"
            if keywords else None,
            # --- Recency-based queries (catch recent related work) ---
            # Same component, resolved
            f"{base}{comp_clause} AND statusCategory = Done ORDER BY updated DESC"
            if comp_clause else None,
            # Same component, any status
            f"{base}{comp_clause} ORDER BY updated DESC"
            if comp_clause else None,
            # Whole project, resolved
            f"{base} AND statusCategory = Done ORDER BY updated DESC",
        ]

        for jql in queries:
            if jql is None:
                continue
            try:
                logger.info("find_similar_tickets candidate JQL: %s", jql)
                issues = self.jira_client.search_issues(
                    jql, maxResults=pool_size, fields=fields,
                )
                for issue in issues:
                    if issue.key not in candidates:
                        candidates[issue.key] = issue
            except Exception as exc:
                logger.warning("find_similar_tickets JQL failed: %s", exc)
            if len(candidates) >= pool_size:
                break

        if not candidates:
            return empty_result

        # --- Step 2: rank by semantic similarity ---
        candidate_list = list(candidates.values())
        candidate_summaries = [
            getattr(iss.fields, "summary", "") or "" for iss in candidate_list
        ]

        scored: List[tuple] = []
        if embed_fn is not None:
            try:
                all_texts = [summary] + candidate_summaries
                embeddings = embed_fn.embed_documents(all_texts)
                source_vec = embeddings[0]

                for i, issue in enumerate(candidate_list):
                    score = self._cosine_sim(source_vec, embeddings[i + 1])
                    if score >= self._SIMILARITY_THRESHOLD:
                        scored.append((score, issue))

                scored.sort(key=lambda x: x[0], reverse=True)
                logger.info(
                    "find_similar_tickets: %d candidates, %d above threshold %.2f",
                    len(candidate_list), len(scored), self._SIMILARITY_THRESHOLD,
                )
            except Exception as exc:
                logger.warning("Embedding similarity failed, returning unranked: %s", exc)
                scored = [(0.0, iss) for iss in candidate_list]
        else:
            logger.warning("No embedding function available; returning unranked candidates")
            scored = [(0.0, iss) for iss in candidate_list]

        top = scored[:max_results]
        if not top:
            return empty_result

        results_list: List[Dict[str, Any]] = []
        for score, issue in top:
            f = issue.fields
            comment_count = 0
            if hasattr(f, "comment") and f.comment:
                comment_count = (
                    f.comment.total
                    if hasattr(f.comment, "total")
                    else len(f.comment.comments or [])
                )
            results_list.append({
                "key": issue.key,
                "summary": getattr(f, "summary", "") or "",
                "status": f.status.name if hasattr(f, "status") and f.status else "",
                "resolution": f.resolution.name if hasattr(f, "resolution") and f.resolution else "",
                "assignee": f.assignee.displayName if hasattr(f, "assignee") and f.assignee else "Unassigned",
                "updated": (f.updated or "")[:10] if hasattr(f, "updated") else "",
                "comment_count": comment_count,
                "similarity": round(score, 3),
            })

        return {
            "source": {"key": ticket_id, "summary": summary},
            "similar_tickets": results_list,
        }

    @staticmethod
    def _cosine_sim(a: List[float], b: List[float]) -> float:
        """Cosine similarity between two vectors."""
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def get_similar_tickets_context(self, ticket_ids: List[str]) -> str:
        """Build an LLM-friendly text block from the resolution details and
        comments of the given tickets."""
        if not self.jira_client or not ticket_ids:
            return ""

        sections: List[str] = []
        for tid in ticket_ids[:10]:
            try:
                issue = self.jira_client.issue(
                    tid,
                    fields="summary,status,resolution,description,comment,assignee",
                )
            except Exception:
                continue

            f = issue.fields
            lines = [
                f"## {tid}: {getattr(f, 'summary', '')}",
                f"Status: {f.status.name if hasattr(f, 'status') and f.status else 'Unknown'}",
                f"Resolution: {f.resolution.name if hasattr(f, 'resolution') and f.resolution else 'N/A'}",
                f"Assignee: {f.assignee.displayName if hasattr(f, 'assignee') and f.assignee else 'Unassigned'}",
            ]

            if getattr(f, "description", None):
                desc = f.description[:2000]
                lines.append(f"\nDescription (truncated):\n{desc}")

            if hasattr(f, "comment") and f.comment and f.comment.comments:
                lines.append(f"\nComments ({len(f.comment.comments)}):")
                for c in f.comment.comments[-5:]:
                    author = getattr(c.author, "displayName", "Unknown")
                    body = c.body.strip()[:1000]
                    lines.append(f"  [{author}]: {body}")

            sections.append("\n".join(lines))

        return "\n\n---\n\n".join(sections)

    def test_jira_connection(self) -> bool:
        try:
            if self.jira_client:
                self.jira_client.myself()
                return True
            return False
        except Exception:
            return False

    def add_comment(self, ticket_id: str, comment: str) -> bool:
        if not self.jira_client:
            return False
        try:
            self.jira_client.add_comment(ticket_id, comment)
            return True
        except Exception:
            return False

    def get_ticket_comments(self, ticket_id: str) -> List[Dict[str, Any]]:
        if not self.jira_client:
            return []
        try:
            issue = self.jira_client.issue(ticket_id, fields='comment')
            comments = []
            if hasattr(issue.fields, 'comment') and issue.fields.comment:
                for comment in issue.fields.comment.comments:
                    comments.append({
                        'author': getattr(comment.author, 'displayName', 'Unknown'),
                        'body': comment.body,
                        'created': comment.created
                    })
            return comments
        except Exception:
            return []

    def get_ticket_attachments(self, ticket_id: str) -> List[Dict[str, Any]]:
        if not self.jira_client:
            return []
        try:
            issue = self.jira_client.issue(ticket_id, fields='attachment')
            attachments = []
            if hasattr(issue.fields, 'attachment') and issue.fields.attachment:
                for att in issue.fields.attachment:
                    attachments.append({
                        'filename': att.filename,
                        'size': att.size,
                        'content_url': att.content,
                        'mime_type': getattr(att, 'mimeType', 'application/octet-stream'),
                        'created': att.created
                    })
            return attachments
        except Exception:
            return []

    def get_confluence_page_content(self, page_id: str) -> Optional[Dict[str, Any]]:
        if not self.confluence_client:
            return None
        try:
            page = self.confluence_client.get_page_by_id(page_id, expand='body.storage')
            soup = BeautifulSoup(page['body']['storage']['value'], 'html.parser')
            page_text = soup.get_text(separator="\n", strip=True)
            content = f"Source: Confluence Page {page_id}\nTitle: {page['title']}\n\n{page_text}"
            return {
                "text": content,
                "meta": {
                    "source_type": "confluence",
                    "title": page.get('title', ''),
                    "url": f"/pages/{page_id}",
                    "page_id": page_id
                }
            }
        except Exception:
            return None

    def get_confluence_page_title(self, page_id: str) -> Optional[str]:
        if not self.confluence_client:
            return None
        try:
            page = self.confluence_client.get_page_by_id(page_id, expand='body.storage')
            return page.get('title', '')
        except Exception:
            return None

    def publish_to_confluence(self, space_key: str, title: str, markdown_body: str) -> str:
        if not self.confluence_client:
            raise RuntimeError("Confluence client not initialized.")
        html_body = md.markdown(markdown_body, extensions=['extra'])
        page = self.confluence_client.create_page(
            space=space_key,
            title=title,
            body=html_body,
            representation='storage'
        )
        return self._build_confluence_url(page)

    def _build_confluence_url(self, page: Dict) -> str:
        if not isinstance(page, dict):
            return "Published (URL unavailable)."
        base = self.confluence_client.url.rstrip('/')
        webui = page.get('_links', {}).get('webui')
        if webui:
            return f"{base}{webui}"
        pid = page.get('id') or page.get('content', {}).get('id')
        if pid:
            return f"{base}/pages/{pid}"
        return "Published (URL unavailable)."

    def test_confluence_connection(self) -> bool:
        try:
            if self.confluence_client:
                self.confluence_client.get_all_spaces(limit=1)
                return True
            return False
        except Exception:
            return False

    @staticmethod
    def extract_page_id_from_url(url: str) -> Optional[str]:
        match = re.search(r'/pages/(\d+)', url)
        return match.group(1) if match else None

    @staticmethod
    def extract_ticket_id_from_url(url: str) -> str:
        stripped = url.strip().rstrip('/')
        if not stripped:
            return ""
        segment = stripped.split('/')[-1]
        match = re.match(r'^[A-Z][A-Z0-9_]+-\d+', segment)
        return match.group(0) if match else segment
