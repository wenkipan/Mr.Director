"""Shell tool: run shell commands (sandboxed to safe operations like ffprobe)."""

from __future__ import annotations

import asyncio
import shlex

from app.tools.registry import registry

ALLOWED_COMMANDS = {"ffprobe", "ls", "cat", "head", "wc", "file", "du", "mediainfo"}


@registry.register(
    name="run_shell",
    description="Run a shell command. Primarily used for ffprobe to get media file info. "
    "Allowed commands: ffprobe, ls, cat, head, wc, file, du, mediainfo.",
    parameters={
        "type": "OBJECT",
        "properties": {
            "command": {
                "type": "STRING",
                "description": "The shell command to execute, e.g. 'ffprobe -v quiet -print_format json -show_format -show_streams /path/to/video.mp4'",
            },
        },
        "required": ["command"],
    },
)
async def run_shell(args: dict, state) -> dict:
    command = args["command"]

    # Basic safety: check the base command is allowed
    try:
        parts = shlex.split(command)
    except ValueError as e:
        return {"error": f"Invalid command syntax: {e}"}

    if not parts:
        return {"error": "Empty command"}

    base_cmd = parts[0].split("/")[-1]  # handle full paths
    if base_cmd not in ALLOWED_COMMANDS:
        return {"error": f"Command '{base_cmd}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_COMMANDS))}"}

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)

        stdout_str = stdout.decode("utf-8", errors="replace")
        stderr_str = stderr.decode("utf-8", errors="replace")

        # Truncate very long outputs
        if len(stdout_str) > 30000:
            stdout_str = stdout_str[:30000] + "\n... (truncated)"

        return {
            "exit_code": proc.returncode,
            "stdout": stdout_str,
            "stderr": stderr_str if proc.returncode != 0 else "",
        }
    except asyncio.TimeoutError:
        return {"error": "Command timed out (60s limit)"}
    except Exception as e:
        return {"error": f"Command failed: {str(e)}"}
