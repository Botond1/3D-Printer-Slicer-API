"""Synthetic archive and filesystem helpers for isolated S3a-V2C tests."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
INSTALLER_PATH = ROOT / "scripts" / "install-swiper-vendor.py"


def load_installer():
    spec = importlib.util.spec_from_file_location("s3a_v2c_installer", INSTALLER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load Swiper installer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def package_entries(*, version: str = "12.1.2", missing: str | None = None,
                    js: bytes = b"/* synthetic Swiper 12.1.2 JS */",
                    css: bytes = b"/* synthetic Swiper 12.1.2 CSS */") -> list[tuple[str, bytes, str]]:
    metadata = json.dumps({"name": "swiper", "version": version, "license": "MIT"}).encode()
    values = {
        "package/package.json": metadata,
        "package/swiper-bundle.min.js": js,
        "package/swiper-bundle.min.css": css,
        "package/LICENSE": b"MIT License\n",
    }
    return [(name, data, "file") for name, data in values.items() if Path(name).name != missing]


def write_archive(path: Path, entries: list[tuple[str, bytes, str]]) -> None:
    with tarfile.open(path, "w:gz") as archive:
        for name, data, kind in entries:
            member = tarfile.TarInfo(name)
            member.mtime = 0
            if kind == "file":
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            elif kind == "dir":
                member.type = tarfile.DIRTYPE
                archive.addfile(member)
            elif kind == "symlink":
                member.type = tarfile.SYMTYPE
                member.linkname = data.decode()
                archive.addfile(member)
            elif kind == "hardlink":
                member.type = tarfile.LNKTYPE
                member.linkname = data.decode()
                archive.addfile(member)
            else:
                raise ValueError(kind)


@contextlib.contextmanager
def synthetic_digest(module, archive_path: Path):
    content = archive_path.read_bytes()
    sha256 = hashlib.sha256(content).hexdigest()
    sha512 = hashlib.sha512(content).hexdigest()
    integrity = "sha512-" + base64.b64encode(bytes.fromhex(sha512)).decode("ascii")
    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch.object(module, "EXPECTED_SHA256", sha256))
        stack.enter_context(mock.patch.object(module, "EXPECTED_SHA512", sha512))
        stack.enter_context(mock.patch.object(module, "EXPECTED_INTEGRITY", integrity))
        yield


def make_orca_root(root: Path) -> tuple[Path, Path]:
    targets = []
    for branch in ("include", "guide"):
        target = root / "resources" / "web" / branch / "swiper"
        target.mkdir(parents=True)
        (target / "original.txt").write_text(f"original-{branch}", encoding="utf-8")
        targets.append(target)
    return targets[0], targets[1]


def copy_package_tree(root: Path, *, js: bytes = b"new-js", css: bytes = b"new-css") -> None:
    root.mkdir(parents=True)
    (root / "package.json").write_text(
        json.dumps({"name": "swiper", "version": "12.1.2", "license": "MIT"}), encoding="utf-8"
    )
    (root / "swiper-bundle.min.js").write_bytes(js)
    (root / "swiper-bundle.min.css").write_bytes(css)
    (root / "LICENSE").write_text("MIT License\n", encoding="utf-8")
