"""Hardened create-new evidence files for synthetic queue qualification."""

from __future__ import annotations

import json
import os
import re
import secrets
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterable, Protocol, Sequence
from urllib import error as urllib_error
from urllib import request as urllib_request


CLEANUP_MANIFEST_SCHEMA = "i12-queue-cleanup-v1"
MAX_CLEANUP_MANIFEST_BYTES = 8 * 1024
MAX_CLEANUP_MANIFEST_RECORDS = 3
MAX_CLEANUP_MANIFEST_PATH_BYTES = 4096
MAX_CLEANUP_MANIFEST_PATH_PARTS = 64
MAX_OUTPUT_INVENTORY_BYTES = 16 * 1024
INVENTORY_TIMEOUT_SECONDS = 2.0
JOB_ID_PATTERN = re.compile(r"^job-[a-f0-9]{32}$")
ARTIFACT_ID_PATTERN = re.compile(r"^artifact-[a-f0-9]{32}$")


class CleanupManifestError(RuntimeError):
    """Fixed-code failure that never includes paths, bodies, or credentials."""


class CreateNewPublicationError(CleanupManifestError):
    """A create-new target exists, but its final durability is uncertain."""

    def __init__(self, stage: str, byte_count: int):
        super().__init__("create_new_publication_committed_uncertain")
        self.state = "committed_uncertain"
        self.stage = stage
        self.byte_count = byte_count


class CleanupRecord(Protocol):
    job_id: str
    artifact_id: str


class InventoryResult(Protocol):
    job_id: str | None
    artifact_id: str | None


@dataclass(frozen=True, order=True)
class CleanupPair:
    job_id: str
    artifact_id: str


@dataclass(frozen=True)
class ManagedOutputInventory:
    http_status: int
    valid: bool
    reason: str
    total: int | None = None
    pairs: tuple[CleanupPair, ...] = ()


def valid_cleanup_pair(job_id: object, artifact_id: object) -> bool:
    return (
        isinstance(job_id, str)
        and JOB_ID_PATTERN.fullmatch(job_id) is not None
        and isinstance(artifact_id, str)
        and ARTIFACT_ID_PATTERN.fullmatch(artifact_id) is not None
    )


def serialize_cleanup_manifest(records: Iterable[CleanupRecord]) -> bytes:
    pairs: list[dict[str, str]] = []
    seen_jobs: set[str] = set()
    seen_artifacts: set[str] = set()
    for record in records:
        if not valid_cleanup_pair(record.job_id, record.artifact_id):
            raise CleanupManifestError("cleanup_manifest_identity_invalid")
        if record.job_id in seen_jobs or record.artifact_id in seen_artifacts:
            raise CleanupManifestError("cleanup_manifest_identity_collision")
        seen_jobs.add(record.job_id)
        seen_artifacts.add(record.artifact_id)
        pairs.append({"job_id": record.job_id, "artifact_id": record.artifact_id})
    if len(pairs) > MAX_CLEANUP_MANIFEST_RECORDS:
        raise CleanupManifestError("cleanup_manifest_record_limit_exceeded")
    pairs.sort(key=lambda pair: (pair["job_id"], pair["artifact_id"]))
    document = {"schema_version": CLEANUP_MANIFEST_SCHEMA, "artifacts": pairs}
    payload = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("ascii") + b"\n"
    if len(payload) > MAX_CLEANUP_MANIFEST_BYTES:
        raise CleanupManifestError("cleanup_manifest_size_exceeded")
    return payload


def parse_managed_output_inventory(http_status: int, body: object) -> ManagedOutputInventory:
    if http_status != 200:
        reason = "artifact_auth_rejected" if http_status == 401 else "artifact_inventory_unavailable"
        return ManagedOutputInventory(http_status, False, reason)
    if not isinstance(body, dict) or body.get("success") is not True:
        return ManagedOutputInventory(http_status, False, "artifact_inventory_shape_invalid")
    total = body.get("total")
    files = body.get("files")
    if (
        not isinstance(total, int)
        or isinstance(total, bool)
        or total < 0
        or total > MAX_CLEANUP_MANIFEST_RECORDS
        or not isinstance(files, list)
        or len(files) != total
    ):
        return ManagedOutputInventory(http_status, False, "artifact_inventory_count_invalid")
    pairs: list[CleanupPair] = []
    seen_jobs: set[str] = set()
    seen_artifacts: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            return ManagedOutputInventory(http_status, False, "artifact_inventory_entry_invalid")
        job_id = item.get("job_id")
        artifact_id = item.get("artifact_id")
        if not valid_cleanup_pair(job_id, artifact_id):
            return ManagedOutputInventory(http_status, False, "artifact_inventory_identity_invalid")
        if job_id in seen_jobs or artifact_id in seen_artifacts:
            return ManagedOutputInventory(http_status, False, "artifact_inventory_identity_collision")
        seen_jobs.add(job_id)
        seen_artifacts.add(artifact_id)
        pairs.append(CleanupPair(job_id, artifact_id))
    return ManagedOutputInventory(
        http_status=http_status,
        valid=True,
        reason="ok",
        total=total,
        pairs=tuple(sorted(pairs)),
    )


def request_managed_output_inventory(
    base_url: str,
    artifact_key: str,
    *,
    opener=urllib_request.urlopen,
) -> ManagedOutputInventory:
    target = f"{base_url.rstrip('/')}/admin/output-files"
    request = urllib_request.Request(
        target,
        headers={"Accept": "application/json", "x-api-key": artifact_key},
        method="GET",
    )
    try:
        with opener(request, timeout=INVENTORY_TIMEOUT_SECONDS) as response:
            status = int(response.getcode())
            raw = response.read(MAX_OUTPUT_INVENTORY_BYTES + 1)
    except urllib_error.HTTPError as exc:
        return parse_managed_output_inventory(int(exc.code), None)
    except (urllib_error.URLError, OSError, TimeoutError, ValueError):
        return ManagedOutputInventory(0, False, "artifact_inventory_transport_failure")
    if len(raw) > MAX_OUTPUT_INVENTORY_BYTES:
        return ManagedOutputInventory(status, False, "artifact_inventory_response_too_large")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ManagedOutputInventory(status, False, "artifact_inventory_json_invalid")
    return parse_managed_output_inventory(status, body)


def authenticate_artifact_inventory(
    base_url: str,
    candidates: Sequence[str],
) -> tuple[str, ManagedOutputInventory]:
    for candidate in candidates:
        inventory = request_managed_output_inventory(base_url, candidate)
        if inventory.http_status != 401:
            return candidate, inventory
    raise RuntimeError("artifact_inventory_authentication_failure")


def evaluate_inventory_contract(
    *,
    preflight: ManagedOutputInventory,
    postflight: ManagedOutputInventory,
    results: Sequence[InventoryResult],
    expected_count: int,
) -> dict:
    reasons: list[str] = []
    if not preflight.valid:
        reasons.append("artifact_inventory_preflight_invalid")
    elif preflight.total != 0 or preflight.pairs:
        reasons.append("managed_output_not_empty_before_load")
    if not postflight.valid:
        reasons.append("artifact_inventory_postflight_invalid")
    observed_pairs = {
        CleanupPair(result.job_id, result.artifact_id)
        for result in results
        if valid_cleanup_pair(result.job_id, result.artifact_id)
    }
    post_pairs = set(postflight.pairs) if postflight.valid else set()
    if postflight.valid:
        if len(post_pairs) != expected_count:
            reasons.append("managed_output_count_mismatch")
        if not observed_pairs.issubset(post_pairs):
            reasons.append("response_identity_missing_from_inventory")
        unidentified_results = sum(
            not valid_cleanup_pair(result.job_id, result.artifact_id)
            for result in results
        )
        if len(post_pairs - observed_pairs) > unidentified_results:
            reasons.append("inventory_identity_not_correlated")
    reasons = list(dict.fromkeys(reasons))
    return {
        "inventory_contract_passed": not reasons,
        "reason_codes": reasons,
        "preflight_pair_count": len(preflight.pairs),
        "postflight_pair_count": len(postflight.pairs),
        "response_pair_count": len(observed_pairs),
        "response_loss_reconciled_count": len(post_pairs - observed_pairs),
    }


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    attributes = getattr(metadata, "st_file_attributes", 0)
    return stat.S_ISLNK(metadata.st_mode) or bool(attributes & reparse_flag)


def _normal_create_new_target(raw_target: str) -> Path:
    if not isinstance(raw_target, str) or not raw_target or "\x00" in raw_target:
        raise CleanupManifestError("cleanup_manifest_path_invalid")
    target = Path(os.path.abspath(raw_target))
    encoded = os.fspath(target).encode("utf-8", errors="strict")
    if (
        len(encoded) > MAX_CLEANUP_MANIFEST_PATH_BYTES
        or len(target.parts) > MAX_CLEANUP_MANIFEST_PATH_PARTS
        or target.name in {"", ".", ".."}
    ):
        raise CleanupManifestError("cleanup_manifest_path_invalid")
    parent = target.parent
    try:
        parent_metadata = parent.lstat()
    except OSError as exc:
        raise CleanupManifestError("cleanup_manifest_parent_invalid") from exc
    resolved_parent = Path(os.path.realpath(parent))
    if (
        not stat.S_ISDIR(parent_metadata.st_mode)
        or _is_link_or_reparse(parent)
        or os.path.normcase(os.fspath(resolved_parent)) != os.path.normcase(os.fspath(parent))
    ):
        raise CleanupManifestError("cleanup_manifest_parent_invalid")
    if os.name != "nt" and parent_metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise CleanupManifestError("cleanup_manifest_parent_permissions_invalid")
    if os.path.lexists(target):
        raise CleanupManifestError("cleanup_manifest_target_exists")
    return target


def _open_exclusive_temporary(target: Path) -> tuple[Path, BinaryIO]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    for _ in range(8):
        temporary = target.parent / f".{target.name}.{secrets.token_hex(8)}.tmp"
        try:
            descriptor = os.open(temporary, flags, 0o600)
        except FileExistsError:
            continue
        try:
            os.chmod(temporary, 0o600)
            return temporary, os.fdopen(descriptor, "wb")
        except Exception:
            os.close(descriptor)
            temporary.unlink(missing_ok=True)
            raise
    raise CleanupManifestError("cleanup_manifest_temp_collision")


def _fsync_parent(parent: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _identity(path: Path) -> tuple[int, int]:
    metadata = path.lstat()
    return metadata.st_dev, metadata.st_ino


@dataclass
class CreateNewFileWriter:
    target: Path
    temporary: Path
    handle: BinaryIO
    parent_identity: tuple[int, int]
    temporary_identity: tuple[int, int]
    max_bytes: int
    finished: bool = False
    state: str = "prepared"
    byte_count: int = 0

    @classmethod
    def prepare(cls, raw_target: str, max_bytes: int) -> "CreateNewFileWriter":
        if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes <= 0:
            raise CleanupManifestError("create_new_size_limit_invalid")
        target = _normal_create_new_target(raw_target)
        parent_metadata = target.parent.stat()
        temporary, handle = _open_exclusive_temporary(target)
        return cls(
            target=target,
            temporary=temporary,
            handle=handle,
            parent_identity=(parent_metadata.st_dev, parent_metadata.st_ino),
            temporary_identity=_identity(temporary),
            max_bytes=max_bytes,
        )

    def _assert_parent_unchanged(self) -> None:
        current_parent = self.target.parent.stat()
        current_identity = (current_parent.st_dev, current_parent.st_ino)
        if current_identity != self.parent_identity or _is_link_or_reparse(self.target.parent):
            raise CleanupManifestError("cleanup_manifest_parent_changed")

    def _unlink_owned_temporary(self) -> None:
        self._assert_parent_unchanged()
        if not os.path.lexists(self.temporary):
            return
        if _is_link_or_reparse(self.temporary) or _identity(self.temporary) != self.temporary_identity:
            raise CleanupManifestError("cleanup_manifest_temp_identity_changed")
        self.temporary.unlink()

    def _raise_committed_uncertain(self, stage: str) -> None:
        self.state = "committed_uncertain"
        self.finished = True
        try:
            if not self.handle.closed:
                self.handle.close()
        except Exception:
            pass
        raise CreateNewPublicationError(stage, self.byte_count)

    def publish_bytes(self, payload: bytes) -> int:
        if self.finished:
            raise CleanupManifestError("cleanup_manifest_writer_already_finished")
        if not isinstance(payload, bytes) or len(payload) > self.max_bytes:
            raise CleanupManifestError("create_new_payload_invalid")
        try:
            written = self.handle.write(payload)
            if written != len(payload):
                raise CleanupManifestError("cleanup_manifest_write_incomplete")
            self.handle.flush()
            os.fsync(self.handle.fileno())
            self._assert_parent_unchanged()
            if os.path.lexists(self.target):
                raise CleanupManifestError("cleanup_manifest_target_exists")
            try:
                os.link(self.temporary, self.target, follow_symlinks=False)
            except FileExistsError as exc:
                raise CleanupManifestError("cleanup_manifest_target_exists") from exc
            self.byte_count = len(payload)
            self.state = "committed_uncertain"
            try:
                os.fchmod(self.handle.fileno(), 0o600)
            except Exception:
                self._raise_committed_uncertain("post_link_chmod")
            try:
                os.fsync(self.handle.fileno())
            except Exception:
                self._raise_committed_uncertain("post_link_file_fsync")
            try:
                self.handle.close()
            except Exception:
                self._raise_committed_uncertain("post_link_close")
            try:
                _fsync_parent(self.target.parent)
            except Exception:
                self._raise_committed_uncertain("post_link_parent_fsync")
            try:
                self._unlink_owned_temporary()
            except Exception:
                self._raise_committed_uncertain("post_link_temp_unlink")
            try:
                _fsync_parent(self.target.parent)
            except Exception:
                self._raise_committed_uncertain("post_unlink_parent_fsync")
            self.state = "committed"
            self.finished = True
            return self.byte_count
        except CreateNewPublicationError:
            raise
        except Exception:
            self.abort()
            raise

    def abort(self) -> None:
        if self.state == "committed":
            self.finished = True
            return
        try:
            if not self.handle.closed:
                self.handle.close()
        except Exception:
            self.state = "abort_uncertain" if self.state == "prepared" else self.state
        try:
            self._unlink_owned_temporary()
        except Exception:
            self.state = "abort_uncertain" if self.state == "prepared" else self.state
        self.finished = True


@dataclass
class CleanupManifestWriter:
    writer: CreateNewFileWriter

    @classmethod
    def prepare(cls, raw_target: str) -> "CleanupManifestWriter":
        return cls(CreateNewFileWriter.prepare(raw_target, MAX_CLEANUP_MANIFEST_BYTES))

    @property
    def target(self) -> Path:
        return self.writer.target

    @property
    def temporary(self) -> Path:
        return self.writer.temporary

    @property
    def state(self) -> str:
        return self.writer.state

    def publish(self, records: Iterable[CleanupRecord]) -> int:
        try:
            payload = serialize_cleanup_manifest(records)
        except Exception:
            self.abort()
            raise
        return self.writer.publish_bytes(payload)

    def abort(self) -> None:
        self.writer.abort()
