"""Convert TimelineProject to FCP7 XML via OpenTimelineIO's fcp_xml adapter."""

import logging

import opentimelineio as otio

from app.models.timeline import TimelineProject
from app.services.otio_export import convert_to_otio

logger = logging.getLogger(__name__)


def convert_to_fcp7xml(timeline: TimelineProject) -> str:
    """Convert MrDV2 TimelineProject to FCP7 XML string.

    Pipeline: TimelineProject -> OTIO Timeline -> FCP7 XML (via otio fcp_xml adapter)
    """
    otio_timeline = convert_to_otio(timeline)
    return otio.adapters.write_to_string(otio_timeline, adapter_name="fcp_xml")


def export_fcpxml_file(timeline: TimelineProject, output_path: str) -> str:
    """Write FCP7 XML to a file. Returns the output path."""
    xml_str = convert_to_fcp7xml(timeline)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(xml_str)
    return output_path
