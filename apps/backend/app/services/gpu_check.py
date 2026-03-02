import logging
import os
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GpuStatus:
    available: bool
    reason: str  # empty when available; specific diagnostic when not
    gl_flag: str  # "angle-egl" or "swangle"


@lru_cache(maxsize=1)
def check_gpu() -> GpuStatus:
    """
    Pre-flight check for GPU-accelerated rendering via EGL on Linux.
    Cached after first call (GPU availability doesn't change at runtime).
    """
    dri = Path("/dev/dri")

    # 1. /dev/dri directory
    if not dri.exists():
        return GpuStatus(
            available=False,
            reason="/dev/dri not found -- no GPU device exposed. "
            "In Docker, use: --device /dev/dri",
            gl_flag="swangle",
        )

    # 2. Render nodes
    render_nodes = sorted(dri.glob("renderD*"))
    if not render_nodes:
        return GpuStatus(
            available=False,
            reason="No DRI render nodes (/dev/dri/renderD*). "
            "GPU driver may not be loaded.",
            gl_flag="swangle",
        )

    # 3. Permissions
    accessible = any(os.access(n, os.R_OK | os.W_OK) for n in render_nodes)
    if not accessible:
        nodes_str = ", ".join(str(n) for n in render_nodes)
        return GpuStatus(
            available=False,
            reason=f"Render nodes exist ({nodes_str}) but are not accessible. "
            "Add user to 'video' or 'render' group.",
            gl_flag="swangle",
        )

    # 4. EGL library
    egl_found = False
    try:
        result = subprocess.run(
            ["ldconfig", "-p"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        egl_found = "libEGL.so" in result.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        egl_paths = [
            "/usr/lib/x86_64-linux-gnu/libEGL.so",
            "/usr/lib/x86_64-linux-gnu/libEGL.so.1",
            "/usr/lib/libEGL.so",
            "/usr/lib64/libEGL.so",
        ]
        egl_found = any(Path(p).exists() for p in egl_paths)

    if not egl_found:
        return GpuStatus(
            available=False,
            reason="libEGL.so not found. "
            "Install: apt install libegl1-mesa (Debian/Ubuntu) "
            "or mesa-libEGL (Fedora/RHEL).",
            gl_flag="swangle",
        )

    logger.info("GPU check passed: EGL rendering available")
    return GpuStatus(available=True, reason="", gl_flag="angle-egl")
