import os
from pathlib import Path


def init_workspace(workspace_dir: str | None = None) -> str:
    """Resolve and create the workspace directory.

    Priority: explicit arg > WORKSPACE_DIR env > ./workspace
    """
    if workspace_dir:
        ws = Path(workspace_dir)
    elif os.getenv("WORKSPACE_DIR"):
        ws = Path(os.environ["WORKSPACE_DIR"])
    else:
        ws = Path.cwd() / "workspace"

    ws = ws.resolve()
    ws.mkdir(parents=True, exist_ok=True)
    return str(ws)
