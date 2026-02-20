import subprocess
from pathlib import Path


def shell(command: str, workspace_dir: str) -> str:
    """Execute a shell command in the workspace directory.
    Use for FFmpeg commands not covered by other tools.

    Args:
        command: The shell command to execute.
        workspace_dir: Path to the workspace directory.

    Returns:
        Command output (stdout + stderr).
    """
    ws = Path(workspace_dir).resolve()

    # Basic safety checks
    blocked = ["rm -rf /", "sudo", "curl", "wget", "pip"]
    for b in blocked:
        if b in command:
            return f"ERROR: Command rejected: contains '{b}'"

    result = subprocess.run(
        command,
        shell=True,
        capture_output=True,
        text=True,
        cwd=str(ws),
        timeout=300,
    )
    output = result.stdout[-2000:] if result.stdout else ""
    if result.returncode != 0:
        output += f"\nSTDERR: {result.stderr[-1000:]}"
    return output or "(no output)"
