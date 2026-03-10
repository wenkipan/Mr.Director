"""Unified timeline state manager — single source of truth for all reads/writes.

All timeline access (agent tools, REST API, WebSocket broadcasts) MUST go through
this manager. It holds one in-memory AgentState per project, protected by an
asyncio.Lock to prevent concurrent writes between the agent and frontend.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from app.agent.state import AgentState
from app.config import settings
from app.models.timeline import TimelineProject, migrate_project_data
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)


class TimelineManager:
    def __init__(self) -> None:
        self._states: dict[str, AgentState] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    # ── helpers ──────────────────────────────────────

    def _projects_dir(self) -> Path:
        d = Path(settings.projects_dir)
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _lock_for(self, project_id: str) -> asyncio.Lock:
        if project_id not in self._locks:
            self._locks[project_id] = asyncio.Lock()
        return self._locks[project_id]

    def _load_from_disk(self, project_id: str) -> TimelineProject | None:
        path = self._projects_dir() / f"{project_id}.json"
        if not path.exists():
            return None
        try:
            data = migrate_project_data(json.loads(path.read_text()))
            return TimelineProject(**data)
        except Exception as e:
            logger.warning(f"Failed to load timeline for {project_id}: {e}")
            return None

    def _save_to_disk(self, state: AgentState) -> None:
        if not state.current_timeline:
            return
        path = self._projects_dir() / f"{state.project_id}.json"
        path.write_text(state.current_timeline.model_dump_json(indent=2))

    # ── public API ───────────────────────────────────

    def get_state(self, project_id: str) -> AgentState:
        """Get or create the in-memory state for a project.

        On first access, loads timeline from disk.
        Subsequent calls return the same in-memory instance.
        """
        if project_id not in self._states:
            state = AgentState(project_id=project_id)
            timeline = self._load_from_disk(project_id)
            if timeline:
                state.current_timeline = timeline
            self._states[project_id] = state
        return self._states[project_id]

    def sync_from_disk(self, project_id: str) -> None:
        """Reload timeline from disk into the in-memory state.

        Called at the start of each agent run so the agent always sees
        the latest version (including any frontend edits since last run).
        """
        state = self.get_state(project_id)
        timeline = self._load_from_disk(project_id)
        if timeline:
            state.current_timeline = timeline

    async def save_and_broadcast(self, project_id: str) -> int:
        """Persist current timeline to disk, bump version, broadcast via WS.

        This is the ONE place where timeline is written. Both agent tools
        and the REST API call this method.

        Returns the new version number.
        """
        state = self.get_state(project_id)
        if not state.current_timeline:
            return state.version

        version = state.bump_version()
        self._save_to_disk(state)
        await ws_manager.broadcast_timeline(
            project_id, state.current_timeline.model_dump(), version=version,
        )
        return version

    async def update_from_frontend(
        self, project_id: str, timeline: TimelineProject
    ) -> int:
        """Apply a frontend edit. Acquires lock, rejects if agent is active.

        Returns the new version number.
        Raises ValueError if agent is currently active.
        """
        lock = self._lock_for(project_id)
        async with lock:
            state = self.get_state(project_id)
            if state.agent_active:
                raise ValueError("Agent is currently modifying the timeline.")
            state.current_timeline = timeline
            return await self.save_and_broadcast(project_id)

    def project_exists(self, project_id: str) -> bool:
        path = self._projects_dir() / f"{project_id}.json"
        return path.exists()

    def create_project(self, project_id: str, timeline: TimelineProject) -> None:
        """Create a new project on disk and in memory."""
        state = AgentState(project_id=project_id)
        state.current_timeline = timeline
        self._states[project_id] = state
        self._save_to_disk(state)


# Module-level singleton
timeline_manager = TimelineManager()
