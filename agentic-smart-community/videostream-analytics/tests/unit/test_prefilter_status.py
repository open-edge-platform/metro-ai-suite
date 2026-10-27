"""Detector readiness must describe actual initialization, not config alone."""
from unittest.mock import patch

from shared.config import PrefilterConfig
from stream_monitor.rtsp_monitor import StreamPipeline


def pipeline(config):
    instance = StreamPipeline.__new__(StreamPipeline)
    instance.source_id = "test"
    instance._prefilter_cfg = config
    return instance


def test_disabled_and_missing_model_status():
    instance = pipeline(PrefilterConfig(enabled=False))
    instance._init_prefilter()
    assert instance.prefilter_status == {"status": "disabled", "error": None}
    instance._prefilter_cfg.enabled = True
    instance._init_prefilter()
    assert instance.prefilter_status["status"] == "failed"
    assert instance.prefilter_status["error"]


def test_initialization_failure_and_successful_recovery():
    instance = pipeline(PrefilterConfig(enabled=True, model_path="/models/test.xml"))
    with patch("stream_monitor.rtsp_monitor.YoloPrefilter", side_effect=RuntimeError("compile failed")):
        instance._init_prefilter()
    assert instance.prefilter_status == {"status": "failed", "error": "compile failed"}
    assert instance._prefilter is None
    with patch("stream_monitor.rtsp_monitor.YoloPrefilter"), patch("stream_monitor.rtsp_monitor.FramePrefilter"):
        instance._init_prefilter()
    assert instance.prefilter_status == {"status": "ready", "error": None}
