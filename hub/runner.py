"""
ReAct loop for the Hub Agent.

The LLM has access to tools defined in the tools/ directory.
It loops — calling tools, observing output, deciding next steps —
until it produces a final text response (no more tool calls).

To add a new tool: see tools/__init__.py
"""

import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

from openai import OpenAI
from dotenv import load_dotenv

from tools import SCHEMAS, execute
from tools import os_exec

load_dotenv(Path(__file__).resolve().parent / ".env")

MAX_ROUNDS = 10

# Pre-create client once at startup — not per task
_client = OpenAI(
    api_key=os.getenv("LLM_API_KEY", ""),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
)
_model = os.getenv("LLM_MODEL", "gpt-4o-mini")

_SYSTEM = """\
You are an executor agent running on a {os_type} machine.
You are communicating with an AI orchestrator, not a human — respond concisely and structured.

Use tools as needed: run commands, search the web, chain multiple steps until the task is done.
Adapt your approach to the machine — check [MACHINE SPECS] below to know whether it has a GUI, \
what OS it runs, and what resources are available.

Safety — refuse with one line, do not execute:
  • Deleting/corrupting system files, mass deletion, credential theft, exfiltrating data, disabling security controls

Reply format when done: one short line stating what was done and the result. No greetings, no explanation, no markdown.
Current date/time: {now}\
"""


def run(
    task: str,
    os_type: str,
    pub: Callable[[str], None],
    kill_event: threading.Event,
    timeout: float = 60,
    now: str | None = None,
    system_info: str = "",
) -> str:
    """
    Run the ReAct loop for a given task.
    Calls pub() for each command line streamed in real-time.
    Returns the final LLM summary string.
    """
    if now is None:
        now = datetime.now().strftime("%A %d %B %Y %H:%M")

    os_exec.reset_cwd()

    sys_content = _SYSTEM.format(os_type=os_type, now=now)
    if system_info:
        sys_content += f"\n\n[MACHINE SPECS]\n{system_info}"

    messages: list[dict] = [
        {"role": "system", "content": sys_content},
        {"role": "user",   "content": task},
    ]

    for round_n in range(1, MAX_ROUNDS + 1):
        if kill_event.is_set():
            return "[cancelled]"

        t0 = time.perf_counter()
        response = _client.chat.completions.create(
            model=_model,
            messages=messages,
            tools=SCHEMAS,
            tool_choice="auto",
        )

        msg = response.choices[0].message
        print(f"      R{round_n} LLM : {(time.perf_counter() - t0) * 1000:.0f} ms")

        if not msg.tool_calls:
            return msg.content or ""

        messages.append(msg)

        for tc in msg.tool_calls:
            if kill_event.is_set():
                return "[cancelled]"

            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError as exc:
                messages.append({
                    "role":         "tool",
                    "tool_call_id": tc.id,
                    "content":      f"[error] Invalid tool arguments: {exc}",
                })
                continue

            if name == "os_exec":
                pub(f"$ {args['command']}")

            result = execute(
                name, args,
                timeout=timeout,
                kill_event=kill_event,
                on_line=pub,
            )

            messages.append({
                "role":         "tool",
                "tool_call_id": tc.id,
                "content":      result,
            })

    return "[error] Reached maximum rounds without completing the task"
