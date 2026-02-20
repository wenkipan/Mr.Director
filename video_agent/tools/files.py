import os
from pathlib import Path


def read_file(file_path: str, workspace_dir: str) -> str:
    """Read the content of a file. Supports text files (txt, md, srt, json, etc.).

    Args:
        file_path: Path to the file to read. Can be absolute or relative to workspace.
        workspace_dir: Path to the workspace directory.

    Returns:
        The file content as text.
    """
    p = Path(file_path)
    if not p.is_absolute():
        p = Path(workspace_dir) / p

    if not p.exists():
        return f"ERROR: File not found: {p}"
    if not p.is_file():
        return f"ERROR: Not a file: {p}"

    try:
        content = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"ERROR: Cannot read binary file as text: {p}"

    if len(content) > 50000:
        return content[:50000] + f"\n\n... (truncated, total {len(content)} chars)"
    return content


def write_file(file_path: str, content: str, workspace_dir: str) -> str:
    """Create or overwrite a file with the given content.

    Args:
        file_path: Path for the file. Can be absolute or relative to workspace.
        content: The text content to write.
        workspace_dir: Path to the workspace directory.

    Returns:
        Confirmation message with the file path.
    """
    p = Path(file_path)
    if not p.is_absolute():
        p = Path(workspace_dir) / p

    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return f"File written: {p} ({len(content)} chars)"


def list_files(directory: str, workspace_dir: str) -> str:
    """List files and directories at the given path.

    Args:
        directory: Directory to list. Use "." for workspace root. Can be absolute or relative to workspace.
        workspace_dir: Path to the workspace directory.

    Returns:
        A listing of files and directories with sizes.
    """
    p = Path(directory)
    if not p.is_absolute():
        p = Path(workspace_dir) / p

    if not p.exists():
        return f"ERROR: Directory not found: {p}"
    if not p.is_dir():
        return f"ERROR: Not a directory: {p}"

    entries = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name))
    lines = []
    for entry in entries:
        if entry.is_dir():
            lines.append(f"  [DIR]  {entry.name}/")
        else:
            size = entry.stat().st_size
            if size < 1024:
                size_str = f"{size} B"
            elif size < 1024 * 1024:
                size_str = f"{size / 1024:.1f} KB"
            else:
                size_str = f"{size / (1024 * 1024):.1f} MB"
            lines.append(f"  {size_str:>10}  {entry.name}")

    return f"Directory: {p}\n" + "\n".join(lines) if lines else f"Directory: {p}\n  (empty)"
