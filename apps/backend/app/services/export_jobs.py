from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ExportJob:
    export_id: str
    project_id: str
    status: str = "queued"  # queued | rendering | completed | error
    progress: float = 0.0
    output_path: str = ""
    error: Optional[str] = None


_jobs: dict[str, ExportJob] = {}


def create_job(export_id: str, project_id: str, output_path: str) -> ExportJob:
    job = ExportJob(
        export_id=export_id,
        project_id=project_id,
        output_path=output_path,
    )
    _jobs[export_id] = job
    return job


def get_job(export_id: str) -> ExportJob | None:
    return _jobs.get(export_id)


def update_job(export_id: str, **kwargs) -> None:
    job = _jobs.get(export_id)
    if job is None:
        return
    for k, v in kwargs.items():
        if hasattr(job, k):
            setattr(job, k, v)
