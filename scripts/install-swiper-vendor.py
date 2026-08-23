#!/usr/bin/env python3
"""Install a checksum-pinned Swiper package into both OrcaSlicer web trees."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import tempfile


EXPECTED_URL = "https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz"
EXPECTED_VERSION = "12.1.2"
EXPECTED_LICENSE = "MIT"
EXPECTED_SHA256 = "7780a8143baf0f021fcc3de927cc95c6b79e8fdc6d38e1f5ba2d0ed17d943457"
EXPECTED_SHA512 = (
    "e2020bac8def5d9aa8661ef52353c02eaba4085824fa0a4ec1ed6d3afcf9b84f"
    "641ed9768130f39987e5602c16bd1e0b3af0ab262e9410453e827b96e41b6481"
)
EXPECTED_INTEGRITY = (
    "sha512-4gILrI3vXZqoZh71I1PALqukCFgk+gpOwe1tOvz5uE9kHtl2gTDzmYflYCwWvR4L"
    "OvCrJi6UEEU+gnuW5BtkgQ=="
)
UPSTREAM_COMMIT = "2fd88b718b6854e8d6be7f183e68b73b68dae816"
OLD_VERSION = "7.2.0"
OLD_BUNDLE_HASHES = {
    "swiper-bundle.min.js": "62eb35c7dfb8f9d5bf358c805f3c8063fda32dbf0a81608f2179e8af2ca4ad0e",
    "swiper-bundle.min.css": "f2a3140679d704bd07329d0768adc05ac21751dd5c558d3b9971ac504b48e79c",
}
CRITICAL_FILES = ("package.json", "swiper-bundle.min.js", "swiper-bundle.min.css", "LICENSE")
TARGET_RELATIVE_PATHS = (Path("resources/web/include/swiper"), Path("resources/web/guide/swiper"))
MAX_ARCHIVE_ENTRIES = 512
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024
COPY_CHUNK_BYTES = 1024 * 1024


class VendorInstallError(RuntimeError):
    """A fail-closed Swiper vendor installation error."""


def _regular_file(path: Path, label: str) -> os.stat_result:
    try:
        details = path.lstat()
    except OSError as error:
        raise VendorInstallError(f"{label} is unavailable: {error}") from error
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise VendorInstallError(f"{label} must be a regular non-symlink file")
    return details


def _hash_file(path: Path, algorithms: tuple[str, ...] = ("sha256",)) -> dict[str, str]:
    digests = {name: hashlib.new(name) for name in algorithms}
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(COPY_CHUNK_BYTES), b""):
            for digest in digests.values():
                digest.update(chunk)
    return {name: digest.hexdigest() for name, digest in digests.items()}


def _validated_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members: list[tarfile.TarInfo] = []
    for member in archive:
        members.append(member)
        if len(members) > MAX_ARCHIVE_ENTRIES:
            raise VendorInstallError("archive entry count is outside the allowed range")
    if not members:
        raise VendorInstallError("archive entry count is outside the allowed range")
    seen: set[str] = set()
    total_bytes = 0
    for member in members:
        name = member.name
        path = PurePosixPath(name)
        if not name or "\\" in name or path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
            raise VendorInstallError(f"archive member has an unsafe path: {name!r}")
        if not path.parts or path.parts[0] != "package":
            raise VendorInstallError(f"archive member is outside package/: {name!r}")
        canonical = path.as_posix()
        if canonical in seen:
            raise VendorInstallError(f"archive contains a duplicate member: {canonical}")
        seen.add(canonical)
        if not (member.isfile() or member.isdir()) or member.sparse is not None:
            raise VendorInstallError(f"archive member type is not allowed: {canonical}")
        if member.size < 0:
            raise VendorInstallError(f"archive member has a negative size: {canonical}")
        total_bytes += member.size
        if total_bytes > MAX_UNCOMPRESSED_BYTES:
            raise VendorInstallError("archive uncompressed size exceeds the allowed limit")
    return members


def _extract_members(archive: tarfile.TarFile, members: list[tarfile.TarInfo], destination: Path) -> None:
    destination.mkdir(mode=0o700)
    resolved_destination = destination.resolve(strict=True)
    for member in members:
        relative = Path(*PurePosixPath(member.name).parts)
        output = destination.joinpath(relative)
        output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if resolved_destination not in output.resolve(strict=False).parents:
            raise VendorInstallError(f"archive extraction escaped its staging directory: {member.name}")
        if member.isdir():
            output.mkdir(mode=0o700, exist_ok=True)
            continue
        source = archive.extractfile(member)
        if source is None:
            raise VendorInstallError(f"archive member could not be read: {member.name}")
        written = 0
        with source, output.open("xb") as target:
            while written < member.size:
                chunk = source.read(min(COPY_CHUNK_BYTES, member.size - written))
                if not chunk:
                    raise VendorInstallError(f"archive member is truncated: {member.name}")
                target.write(chunk)
                written += len(chunk)
            if source.read(1):
                raise VendorInstallError(f"archive member exceeds its declared size: {member.name}")


def verify_archive(archive_path: Path, source_url: str, destination: Path) -> Path:
    if source_url != EXPECTED_URL:
        raise VendorInstallError("source URL does not match the pinned Swiper artifact")
    archive_details = _regular_file(archive_path, "Swiper archive")
    if archive_details.st_size > MAX_ARCHIVE_BYTES:
        raise VendorInstallError("Swiper archive compressed size exceeds the allowed limit")
    hashes = _hash_file(archive_path, ("sha256", "sha512"))
    integrity = "sha512-" + base64.b64encode(bytes.fromhex(hashes["sha512"])).decode("ascii")
    if hashes["sha256"] != EXPECTED_SHA256:
        raise VendorInstallError("Swiper archive SHA256 mismatch")
    if hashes["sha512"] != EXPECTED_SHA512 or integrity != EXPECTED_INTEGRITY:
        raise VendorInstallError("Swiper archive SHA512 integrity mismatch")
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = _validated_members(archive)
            _extract_members(archive, members, destination)
    except (OSError, tarfile.TarError) as error:
        raise VendorInstallError(f"Swiper archive processing failed: {error}") from error
    return destination / "package"


def _load_metadata(path: Path) -> dict[str, object]:
    _regular_file(path, f"metadata {path.name}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise VendorInstallError(f"invalid package metadata at {path}") from error
    if not isinstance(value, dict):
        raise VendorInstallError(f"package metadata must be an object at {path}")
    return value


def validate_package(package_root: Path) -> dict[str, str]:
    for name in CRITICAL_FILES:
        _regular_file(package_root / name, f"required Swiper file {name}")
    metadata = _load_metadata(package_root / "package.json")
    if metadata.get("name") != "swiper" or metadata.get("version") != EXPECTED_VERSION:
        raise VendorInstallError("Swiper package name/version does not match the pinned release")
    if metadata.get("license") != EXPECTED_LICENSE:
        raise VendorInstallError("Swiper package license does not match MIT")
    for nested_path in sorted(package_root.rglob("package.json")):
        if _load_metadata(nested_path).get("version") == OLD_VERSION:
            raise VendorInstallError(f"old Swiper metadata remains at {nested_path}")
    hashes = {name: _hash_file(package_root / name)["sha256"] for name in CRITICAL_FILES}
    for name, old_hash in OLD_BUNDLE_HASHES.items():
        if hashes[name] == old_hash:
            raise VendorInstallError(f"old Swiper bundle hash remains for {name}")
    return hashes


def normalize_tree_permissions(root: Path) -> None:
    paths = [root, *sorted(root.rglob("*"))]
    for path in paths:
        try:
            details = path.lstat()
        except OSError as error:
            raise VendorInstallError(f"Swiper resource path is unavailable: {path}") from error
        if stat.S_ISLNK(details.st_mode):
            raise VendorInstallError(f"Swiper resource path must not be a symlink: {path}")
        if stat.S_ISDIR(details.st_mode):
            mode = 0o755
        elif stat.S_ISREG(details.st_mode):
            mode = 0o644
        else:
            raise VendorInstallError(f"Swiper resource path has an unsupported type: {path}")
        try:
            path.chmod(mode)
        except OSError as error:
            raise VendorInstallError(f"Swiper resource permissions could not be normalized: {path}") from error


def _validated_targets(orca_root: Path) -> tuple[Path, Path, Path]:
    try:
        root_details = orca_root.lstat()
    except OSError as error:
        raise VendorInstallError(f"Orca root is unavailable: {error}") from error
    if not stat.S_ISDIR(root_details.st_mode) or stat.S_ISLNK(root_details.st_mode):
        raise VendorInstallError("Orca root must be a non-symlink directory")
    web_root = orca_root / "resources" / "web"
    for path in (web_root, web_root / "include", web_root / "guide"):
        try:
            details = path.lstat()
        except OSError as error:
            raise VendorInstallError(f"required Orca directory is unavailable: {path}") from error
        if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
            raise VendorInstallError(f"required Orca path must be a non-symlink directory: {path}")
    targets = tuple(orca_root / relative for relative in TARGET_RELATIVE_PATHS)
    for target in targets:
        try:
            details = target.lstat()
        except OSError as error:
            raise VendorInstallError(f"Swiper target is unavailable: {target}") from error
        if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
            raise VendorInstallError(f"Swiper target must be a non-symlink directory: {target}")
    return web_root, targets[0], targets[1]


def cleanup_tree(path: Path) -> None:
    if path.exists() or path.is_symlink():
        details = path.lstat()
        if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
            raise VendorInstallError(f"cleanup target is not an expected directory: {path}")
        shutil.rmtree(path)


def _rollback(replacements: list[tuple[Path, Path]]) -> None:
    errors: list[str] = []
    for target, backup in reversed(replacements):
        try:
            if backup.exists():
                cleanup_tree(target)
                os.replace(backup, target)
        except Exception as error:
            errors.append(f"{target}: {error}")
    if errors:
        raise VendorInstallError("Swiper rollback failed: " + "; ".join(errors))


def replace_trees(targets: tuple[Path, Path], staged: tuple[Path, Path], hashes: dict[str, str]) -> None:
    replacements = [(target, target.parent / ".swiper-vendor-backup") for target in targets]
    if any(backup.exists() or backup.is_symlink() for _, backup in replacements):
        raise VendorInstallError("a Swiper backup path already exists")
    try:
        for target, backup in replacements:
            os.replace(target, backup)
        for stage, target in zip(staged, targets, strict=True):
            os.replace(stage, target)
        for target in targets:
            normalize_tree_permissions(target)
            installed_hashes = validate_package(target)
            if installed_hashes != hashes:
                raise VendorInstallError(f"critical Swiper blob hashes differ after replacement: {target}")
    except Exception as error:
        try:
            _rollback(replacements)
        except VendorInstallError as rollback_error:
            raise VendorInstallError(f"Swiper replacement failed: {error}; {rollback_error}") from rollback_error
        if isinstance(error, VendorInstallError):
            raise
        raise VendorInstallError(f"Swiper replacement failed: {error}") from error
    for _, backup in replacements:
        try:
            cleanup_tree(backup)
        except Exception as error:
            raise VendorInstallError(f"Swiper backup cleanup failed: {error}") from error


def _tree_evidence(path: Path) -> tuple[int, int, str, str]:
    files = [item for item in path.rglob("*") if item.is_file() and not item.is_symlink()]
    size = sum(item.stat().st_size for item in files)
    js_hash = _hash_file(path / "swiper-bundle.min.js")["sha256"]
    css_hash = _hash_file(path / "swiper-bundle.min.css")["sha256"]
    return len(files), size, js_hash, css_hash


def install_swiper_vendor(archive_path: Path, orca_root: Path, source_url: str) -> list[str]:
    web_root, include_target, guide_target = _validated_targets(orca_root)
    staging_root = Path(tempfile.mkdtemp(prefix=".swiper-vendor-", dir=web_root))
    primary_error: Exception | None = None
    evidence: list[str] = []
    try:
        package = verify_archive(archive_path, source_url, staging_root / "extracted")
        normalize_tree_permissions(package)
        hashes = validate_package(package)
        staged = (staging_root / "include", staging_root / "guide")
        for target in staged:
            shutil.copytree(package, target)
            normalize_tree_permissions(target)
            if validate_package(target) != hashes:
                raise VendorInstallError(f"staged Swiper copy differs from verified artifact: {target}")
        replace_trees((include_target, guide_target), staged, hashes)
        for label, target in (("include", include_target), ("guide", guide_target)):
            count, size, js_hash, css_hash = _tree_evidence(target)
            evidence.append(
                f"swiper_vendor tree={label} version={EXPECTED_VERSION} files={count} bytes={size} "
                f"js_sha256={js_hash} css_sha256={css_hash}"
            )
    except Exception as error:
        primary_error = error
    try:
        cleanup_tree(staging_root)
    except Exception as cleanup_error:
        if primary_error is not None:
            raise VendorInstallError(f"{primary_error}; Swiper staging cleanup failed: {cleanup_error}") from cleanup_error
        raise VendorInstallError(f"Swiper staging cleanup failed: {cleanup_error}") from cleanup_error
    if primary_error is not None:
        if isinstance(primary_error, VendorInstallError):
            raise primary_error
        raise VendorInstallError(f"Swiper installation failed: {primary_error}") from primary_error
    return evidence


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--orca-root", required=True, type=Path)
    parser.add_argument("--source-url", required=True)
    return parser.parse_args()


def main() -> int:
    arguments = _arguments()
    try:
        evidence = install_swiper_vendor(arguments.archive, arguments.orca_root, arguments.source_url)
    except VendorInstallError as error:
        print(f"swiper_vendor status=failed error={error}", file=sys.stderr)
        return 1
    print(
        f"swiper_vendor status=installed source={EXPECTED_URL} version={EXPECTED_VERSION} "
        f"license={EXPECTED_LICENSE} upstream_commit={UPSTREAM_COMMIT}"
    )
    for line in evidence:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
