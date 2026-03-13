"""Shell tool: run shell commands with blacklist-based safety."""

from __future__ import annotations

import asyncio
import re

from app.tools.registry import registry

# Destructive or dangerous commands that must never be executed
BLOCKED_COMMANDS = {
    # File destruction
    "rm", "rmdir", "shred", "unlink",
    # File mutation (prevent accidental overwrite of user media)
    "mv", "cp", "dd", "truncate",
    # Network access
    "curl", "wget", "nc", "ncat", "ssh", "scp", "rsync", "ftp", "sftp",
    # System modification
    "sudo", "su", "chown", "chmod", "chgrp", "mount", "umount",
    "systemctl", "service", "reboot", "shutdown", "halt", "poweroff",
    # Package management
    "apt", "apt-get", "yum", "dnf", "pacman", "pip", "pip3", "npm", "yarn",
    # Process control (prevent killing user processes)
    "kill", "killall", "pkill",
    # Shell escape / eval
    "eval", "exec", "source",
}

# Shell features that make command scanning unreliable
BLOCKED_PATTERNS = [
    "$(", "`",   # command substitution — can hide arbitrary commands
    ">", ">>",   # output redirection — file writes should go through write_file
]

# Split command string into sub-commands by shell operators: | && || ;
_SPLIT_RE = re.compile(r'\s*(?:\|{1,2}|&&|;)\s*')


def _extract_commands(command: str) -> list[str]:
    """Extract base command names from a (possibly piped/chained) command string.

    Returns a list of base executable names, e.g.:
      "ffprobe -v quiet file.mp4 | grep duration && echo done"
      → ["ffprobe", "grep", "echo"]
    """
    parts = _SPLIT_RE.split(command)
    cmds = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # First token is the command (strip path: /usr/bin/ffprobe → ffprobe)
        tokens = part.split()
        if tokens:
            cmds.append(tokens[0].split("/")[-1])
    return cmds


@registry.register(
    name="run_shell",
    description=(
        "Run a shell command. Most CLI tools are available (ffprobe, ffmpeg, python, grep, etc.). "
        "Pipes (|) and chaining (&&, ||, ;) are allowed. "
        "Blocked: rm, mv, cp, curl, wget, sudo, and other destructive/network commands. "
        "No output redirects (>, >>) or command substitution ($(), ``). 120-second timeout. "
        "\n\nWhen to use: getting media metadata (ffprobe), media processing (ffmpeg), "
        "any task not covered by dedicated tools. This is your general-purpose fallback. "
        "When NOT to use: reading/writing text files (use read_file/write_file for structured output), "
        "modifying the timeline (use timeline tools)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "command": {
                "type": "STRING",
                "description": "Shell command to execute. Pipes and chaining are OK. "
                "Example: 'ffprobe -v quiet -print_format json -show_format -show_streams /path/to/video.mp4'",
            },
        },
        "required": ["command"],
    },
)
async def run_shell(args: dict, state) -> dict:
    command = args["command"]

    # ── Safety checks ──

    # 1. Block patterns that make scanning unreliable or allow file writes
    for pattern in BLOCKED_PATTERNS:
        if pattern in command:
            return {"error": f"Not allowed: '{pattern}'. No output redirects or command substitution."}

    # 2. Extract every sub-command and check against blacklist
    cmds = _extract_commands(command)
    if not cmds:
        return {"error": "Empty command"}

    for cmd in cmds:
        if cmd in BLOCKED_COMMANDS:
            return {"error": f"Command '{cmd}' is blocked for safety."}

    # ── Execute via shell (needed for pipes/chaining) ──

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

        stdout_str = stdout.decode("utf-8", errors="replace")
        stderr_str = stderr.decode("utf-8", errors="replace")

        # Truncate very long outputs
        if len(stdout_str) > 30000:
            stdout_str = stdout_str[:30000] + "\n... (truncated)"
        if len(stderr_str) > 5000:
            stderr_str = stderr_str[:5000] + "\n... (truncated)"

        return {
            "exit_code": proc.returncode,
            "stdout": stdout_str,
            "stderr": stderr_str if proc.returncode != 0 else "",
        }
    except asyncio.TimeoutError:
        return {"error": "Command timed out (120s limit)"}
    except Exception as e:
        return {"error": f"Command failed: {str(e)}"}
