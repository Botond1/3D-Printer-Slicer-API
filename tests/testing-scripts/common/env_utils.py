from __future__ import annotations

import os
from pathlib import Path


def read_dotenv(project_root: Path) -> dict[str, str]:
    env_map: dict[str, str] = {}
    env_path = project_root / ".env"
    if not env_path.exists():
        return env_map

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key.strip()] = value.strip().strip('"').strip("'")

    return env_map


def resolve_base_url(project_root: Path) -> str:
    dotenv = read_dotenv(project_root)
    return os.getenv("SLICER_BASE_URL") or dotenv.get("SLICER_BASE_URL") or "http://127.0.0.1:3000"


def resolve_slice_service_api_key(project_root: Path) -> str | None:
    dotenv = read_dotenv(project_root)
    env_key = os.getenv("SLICE_SERVICE_API_KEY")
    if env_key:
        return env_key
    dotenv_key = dotenv.get("SLICE_SERVICE_API_KEY")
    return dotenv_key or None


def resolve_api_key_candidates(project_root: Path, variable_name: str) -> list[str]:
    dotenv = read_dotenv(project_root)
    env_key = os.getenv(variable_name, "").strip() or None
    dotenv_key = (dotenv.get(variable_name) or "").strip() or None
    ordered = [env_key, dotenv_key]
    seen: set[str] = set()
    candidates: list[str] = []

    for key in ordered:
        if not key or key in seen:
            continue
        candidates.append(key)
        seen.add(key)

    return candidates


def resolve_pricing_api_key_candidates(project_root: Path) -> list[str]:
    return resolve_api_key_candidates(project_root, "PRICING_API_KEY")


def resolve_artifact_api_key_candidates(project_root: Path) -> list[str]:
    return resolve_api_key_candidates(project_root, "ARTIFACT_API_KEY")


def resolve_operations_api_key_candidates(project_root: Path) -> list[str]:
    return resolve_api_key_candidates(project_root, "OPERATIONS_API_KEY")
