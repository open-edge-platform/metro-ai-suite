# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Configuration management :YAML + Pydantic Settings with env var resolution."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings

from analytics_app_shim.lvc.config import LiveCaptioningAnalyticsAppConfig  # noqa: F401
from analytics_app_shim.object_detection.config import ObjectDetectionAnalyticsAppConfig  # noqa: F401


_ENV_VAR_PATTERN = re.compile(r"\$\{(\w+)(?::-(.*?))?\}")


def _resolve_env_vars(value: str) -> str:
    def _replacer(match: re.Match) -> str:
        var_name = match.group(1)
        default = match.group(2)
        env_val = os.environ.get(var_name)
        if env_val is None:
            if default is not None:
                return default
            print(
                f"FATAL: environment variable '{var_name}' is not set "
                f"but is referenced in config.yaml",
                file=sys.stderr,
            )
            sys.exit(1)
        return env_val
    return _ENV_VAR_PATTERN.sub(_replacer, value)


def _resolve_recursive(obj):
    if isinstance(obj, str):
        return _resolve_env_vars(obj)
    if isinstance(obj, dict):
        return {k: _resolve_recursive(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve_recursive(item) for item in obj]
    return obj


class InvalidConfigError(SystemExit):
    """config.yaml failed validation; a user-facing message has already been printed."""


class VmsAuthConfig(BaseModel):
    """VMS auth credentials.

    The plugin **facilitates** auth — it does not maintain long-lived sessions.
    Credentials here are used only when calling the VMS during
    discover/register/write-back. Per-request token pass-through from the
    App is left as a v2 hook.
    """
    username: str = ""
    password: str = ""
    auth_type: Literal["basic", "digest", "none"] = "none"


class VmsInstanceConfig(BaseModel):
    name: str
    vendor: str
    base_url: str = ""
    tls_verify: bool = False
    tls_ca_bundle: str = ""
    auth: VmsAuthConfig = Field(default_factory=VmsAuthConfig)
    # Path to a JSON file containing Nx analytics integration manifests.
    # Expected keys: integrationManifest, engineManifest, deviceAgentManifest, pinCode.
    # Used only by the nx_witness vendor.
    analytics_manifest_path: str | None = None
    # Free-form vendor-specific settings. Preferred over adding new per-vendor
    # top-level fields. Each shim documents the keys it consumes; e.g. the
    # ``milestone`` shim reads ``graphql_url``, ``app_id``, ``app_url``,
    # ``metadata_topic``, ``event_topic``.
    vendor_options: dict[str, Any] = Field(default_factory=dict)

    @field_validator("vendor")
    @classmethod
    def _validate_vendor(cls, v: str) -> str:
        # Lazy import to avoid circular dependency (factory imports config)
        from plugin.core.factory import _VMS_REGISTRY
        known = set(_VMS_REGISTRY.keys())
        if v not in known:
            raise ValueError(f"Unknown vendor '{v}'. Registered vendors: {sorted(known)}")
        return v



AnyCorAppConfig = LiveCaptioningAnalyticsAppConfig | ObjectDetectionAnalyticsAppConfig

# Discriminated union for Pydantic to pick the right config model from the YAML `type` field.
_DiscriminatedAnalyticsAppConfig = Annotated[
    LiveCaptioningAnalyticsAppConfig | ObjectDetectionAnalyticsAppConfig,
    Field(discriminator="type"),
]


class MqttConfig(BaseModel):
    host: str = ""
    port: int = 1883
    tls_enabled: bool = False
    tls_ca_bundle: str = ""
    tls_client_cert: str = ""
    tls_client_key: str = ""


class ApiConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080
    api_key: str = ""


class DatabaseConfig(BaseModel):
    url: str = "postgresql+asyncpg://vms:vms@localhost:5432/vms_plugin"


class LoggingConfig(BaseModel):
    level: str = "info"


class AppConfig(BaseModel):
    vms_instances: list[VmsInstanceConfig] = Field(default_factory=list)
    analytics_apps: list[_DiscriminatedAnalyticsAppConfig] = Field(default_factory=list)  # type: ignore[valid-type]
    api: ApiConfig = Field(default_factory=ApiConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    mqtt: MqttConfig = Field(default_factory=MqttConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

    @model_validator(mode="before")
    @classmethod
    def resolve_env_vars(cls, values):
        values = _resolve_recursive(values)
        if isinstance(values, dict) and "analytics_app" in values and "analytics_apps" not in values:
            legacy = values.pop("analytics_app")
            values["analytics_apps"] = [legacy] if legacy else []
        return values

    @property
    def analytics_app(self) -> "AnyCorAppConfig | None":
        return self.analytics_apps[0] if self.analytics_apps else None


class Settings(BaseSettings):
    config_path: str = "/app/config/config.yaml"
    database_url: str = ""
    model_config = {"env_prefix": "VMS_PLUGIN_"}


def _section_at(raw: Any, loc: tuple) -> Any:
    """Walk ``raw`` along a pydantic error ``loc``, skipping elements that are not keys.

    Discriminated unions add the tag (e.g. ``object_detection``) to ``loc`` even
    though it is not a key in the YAML, so non-matching elements are ignored.
    """
    node = raw
    for part in loc:
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and isinstance(part, int) and part < len(node):
            node = node[part]
    return node


def _empty_env_refs(node: Any) -> list[str]:
    """Env vars referenced under ``node`` that resolve to an empty value."""
    names: list[str] = []

    def _walk(value: Any) -> None:
        if isinstance(value, str):
            for match in _ENV_VAR_PATTERN.finditer(value):
                name, default = match.group(1), match.group(2)
                env_val = os.environ.get(name)
                effective = env_val if env_val is not None else (default or "")
                if effective == "" and name not in names:
                    names.append(name)
        elif isinstance(value, dict):
            for item in value.values():
                _walk(item)
        elif isinstance(value, list):
            for item in value:
                _walk(item)

    _walk(node)
    return names


def _blamed_env_refs(raw: Any, loc: tuple, msg: str) -> list[str]:
    """Empty env vars most likely behind an error.

    Validators name the fields they complain about (e.g. ``pipeline.cpu``); when
    those resolve to config.yaml entries, only their env vars are reported so
    unrelated empty optional values (CA bundles, ...) are not blamed.
    """
    section = _section_at(raw, loc)
    focused: list[str] = []
    for dotted in re.findall(r"\b[a-z_]+(?:\.[a-z_]+)+\b", msg):
        node = section
        for key in dotted.split("."):
            node = node.get(key) if isinstance(node, dict) else None
        for name in _empty_env_refs(node):
            if name not in focused:
                focused.append(name)
    return focused or _empty_env_refs(section)


def _format_config_error(exc: ValidationError, raw: Any, config_path: Path) -> str:
    lines = [f"FATAL: invalid configuration in {config_path}", ""]
    hinted: list[str] = []
    for err in exc.errors():
        loc = tuple(err.get("loc", ()))
        msg = str(err.get("msg", "")).removeprefix("Value error, ")
        lines.append(f"  - {'.'.join(str(p) for p in loc) or '<root>'}: {msg}")
        for name in _blamed_env_refs(raw, loc, msg):
            if name not in hinted:
                hinted.append(name)
    if hinted:
        lines += [
            "",
            "These environment variables are used by the failing section of "
            "config.yaml but are empty or not set:",
            f"    {', '.join(hinted)}",
            "",
            "Set them in your .env file, then recreate the container so the new "
            "values are loaded:",
            "    docker compose up -d --force-recreate backend",
        ]
    return "\n".join(lines)


# Startup loads the config several times; report an invalid config only once.
_reported_config_error: str | None = None


def load_config(path: str | Path | None = None) -> AppConfig:
    try:
        from dotenv import load_dotenv
        _env_file = Path(".env")
        if _env_file.exists():
            load_dotenv(dotenv_path=_env_file, override=False)
    except ImportError:
        pass

    settings = Settings()
    config_path = Path(path) if path else Path(settings.config_path)
    if not config_path.exists():
        print(f"FATAL: config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    with open(config_path) as f:
        raw = yaml.safe_load(f)

    try:
        config = AppConfig(**raw)
    except ValidationError as exc:
        global _reported_config_error
        message = _format_config_error(exc, raw, config_path)
        if message != _reported_config_error:
            print(message, file=sys.stderr)
            _reported_config_error = message
        raise InvalidConfigError(1) from None

    # VMS_PLUGIN_DATABASE_URL, when set, takes precedence over the value
    # resolved from config.yaml so operators can override it without editing
    # the config file (e.g. in docker-compose.yml).
    if settings.database_url:
        config.database.url = settings.database_url

    return config
