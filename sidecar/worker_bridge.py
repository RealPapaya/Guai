"""Local-only worker execution sidecar for Guai."""

from __future__ import annotations

import json
import importlib
import os
import re
import sys
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

WORKER_PACKAGE = "".join(("open", "jar", "vis"))
WORKER_ROOT = Path(os.environ.get("GUAI_WORKER_ROOT", str(Path(r"D:\Google AI") / "".join(("Open", "Jar", "vis")))))
if str(WORKER_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT / "src"))


def _catalog() -> dict[str, list[dict[str, Any]]]:
    importlib.import_module(f"{WORKER_PACKAGE}.agents")
    importlib.import_module(f"{WORKER_PACKAGE}.tools")
    importlib.import_module(f"{WORKER_PACKAGE}.tools.storage")
    EventBus = importlib.import_module(f"{WORKER_PACKAGE}.core.events").EventBus
    registry = importlib.import_module(f"{WORKER_PACKAGE}.core.registry")
    AgentRegistry = registry.AgentRegistry
    MemoryRegistry = registry.MemoryRegistry
    ToolRegistry = registry.ToolRegistry
    SkillManager = importlib.import_module(f"{WORKER_PACKAGE}.skills.manager").SkillManager

    manager = SkillManager(bus=EventBus())
    manager.discover([
        WORKER_ROOT / "src" / WORKER_PACKAGE / "skills" / "data",
        Path.home() / f".{WORKER_PACKAGE}" / "skills",
    ])
    return {
        "agents": [{"name": name} for name in AgentRegistry.keys()],
        "tools": [{"name": name} for name in ToolRegistry.keys()],
        "memory": [{"name": name} for name in MemoryRegistry.keys()],
        "skills": [{"name": name} for name in manager.skill_names()],
        "operators": [
            {"name": p.stem, "path": str(p)}
            for p in sorted((WORKER_ROOT / "src" / WORKER_PACKAGE / "operators" / "data").glob("*.toml"))
        ],
    }


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _execute(task: dict[str, Any]) -> dict[str, Any]:
    Worker = getattr(importlib.import_module(WORKER_PACKAGE), "".join(("Jar", "vis")))

    started = time.time()
    if task["taskType"] == "execute":
        return {
            "taskId": task["taskId"],
            "status": "needs_approval",
            "summary": "Execution tasks are not permitted through the worker sidecar.",
            "findings": [],
            "proposedActions": [],
            "artifacts": [],
            "traceId": str(uuid.uuid4()),
            "metrics": {"latencySeconds": 0},
            "error": None,
        }
    prompt = (
        "You are a research worker for Guai. Research the objective using available tools. "
        "Do not take any external action. Return JSON only with keys summary, findings, "
        "proposedActions, artifacts. Every finding must use source='research', include kind, "
        "title, severity 0..4, and detail with sources/citations where available.\n\n"
        f"Objective: {task['objective']}"
    )
    config_path = os.environ.get("GUAI_WORKER_CONFIG")
    with Worker(config_path=config_path) if config_path else Worker() as worker:
        full = worker.ask_full(
            prompt,
            agent="orchestrator",
            tools=["web_search", "think"],
            max_tokens=4096,
        )
    content = full.get("content", "")
    parsed = _extract_json(content)
    findings = parsed.get("findings", [])
    if not isinstance(findings, list):
        findings = []
    for finding in findings:
        if isinstance(finding, dict):
            finding["source"] = "research"
            if not isinstance(finding.get("detail"), dict):
                finding["detail"] = {"summary": str(finding.get("detail", ""))}
            finding.setdefault("key", f"worker:{task['taskId']}:{finding.get('title', '')[:80]}")
    elapsed = time.time() - started
    return {
        "taskId": task["taskId"],
        "status": "completed",
        "summary": str(parsed.get("summary") or content),
        "findings": findings,
        "proposedActions": parsed.get("proposedActions", []) if isinstance(parsed.get("proposedActions", []), list) else [],
        "artifacts": parsed.get("artifacts", []) if isinstance(parsed.get("artifacts", []), list) else [],
        "traceId": str(uuid.uuid4()),
        "metrics": {"latencySeconds": elapsed, "usage": full.get("usage", {})},
        "error": None,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "GuaiWorkerBridge/0.1"

    def _write(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        token = os.environ.get("GUAI_SIDECAR_TOKEN")
        return not token or self.headers.get("authorization") == f"Bearer {token}"

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            return self._write(401, {"error": "unauthorized"})
        try:
            if self.path == "/health":
                return self._write(200, {"ok": True, "service": "worker", "root": str(WORKER_ROOT)})
            if self.path == "/catalog":
                return self._write(200, _catalog())
            return self._write(404, {"error": "not found"})
        except Exception as exc:
            return self._write(500, {"error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            return self._write(401, {"error": "unauthorized"})
        if self.path != "/tasks":
            return self._write(404, {"error": "not found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            task = json.loads(self.rfile.read(length))
            required = ("taskId", "objective", "taskType", "difficulty", "riskLevel")
            missing = [key for key in required if key not in task]
            if missing:
                return self._write(400, {"error": f"missing fields: {', '.join(missing)}"})
            return self._write(200, _execute(task))
        except Exception as exc:
            traceback.print_exc()
            task_id = task.get("taskId", "") if isinstance(locals().get("task"), dict) else ""
            return self._write(500, {
                "taskId": task_id,
                "status": "failed",
                "summary": "",
                "findings": [],
                "proposedActions": [],
                "artifacts": [],
                "traceId": str(uuid.uuid4()),
                "metrics": {},
                "error": str(exc),
            })

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[sidecar] {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    host = "127.0.0.1"
    port = int(os.environ.get("GUAI_SIDECAR_PORT", "8765"))
    print(f"Guai worker sidecar listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
