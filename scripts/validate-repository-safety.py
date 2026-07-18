#!/usr/bin/env python3
"""Guard indexed repository content against unsafe or private artifacts.

The size ceiling is 1 MiB per indexed blob. The allowlist is intentionally
limited to the repository's one pre-existing oversized favicon and must remain
an exact-path list. Secret detection is heuristic: it recognizes common PEM
markers and literal assignments to high-risk credential names, but it is not a
replacement for a dedicated history-aware secret scanner.
"""

from __future__ import annotations

import argparse
import codecs
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath


MAX_FILE_BYTES = 1024 * 1024

# Exact-path exception for a pre-existing tracked UI asset. Do not broaden this
# to a directory or extension pattern; new oversized files require review.
LARGE_FILE_ALLOWLIST = frozenset({"app/static/favicon.ico"})

ALLOWED_POLICY_SENTINELS = frozenset(
    {
        "input/.gitkeep",
        "output/.gitkeep",
        "tests/testing-files/.gitkeep",
        "tests/testing-scripts/results/.gitkeep",
    }
)

_PEM_BEGIN = b"-----" + b"BEGIN "
_PRIVATE_MATERIAL_MARKERS = (
    _PEM_BEGIN + b"PRIVATE KEY" + b"-----",
    _PEM_BEGIN + b"ENCRYPTED PRIVATE KEY" + b"-----",
    _PEM_BEGIN + b"RSA PRIVATE KEY" + b"-----",
    _PEM_BEGIN + b"DSA PRIVATE KEY" + b"-----",
    _PEM_BEGIN + b"EC PRIVATE KEY" + b"-----",
    _PEM_BEGIN + b"OPENSSH PRIVATE KEY" + b"-----",
    _PEM_BEGIN + b"PGP PRIVATE KEY BLOCK" + b"-----",
)

_CREDENTIAL_NAME = (
    r"(?:[A-Z0-9]+_)*(?:API_KEY|SECRET|SECRET_KEY|SECRET_ACCESS_KEY|"
    r"ACCESS_KEY|ACCESS_KEY_ID|CLIENT_SECRET|AUTH_TOKEN|BEARER_TOKEN|TOKEN|"
    r"PASSWORD|PASSWD|PRIVATE_KEY)(?:_[A-Z0-9]+)*"
)

_ENV_OR_CODE_ASSIGNMENT = re.compile(
    rf"^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?"
    rf"(?P<name>{_CREDENTIAL_NAME})\s*=\s*(?P<value>.*?)\s*$",
    re.IGNORECASE,
)

_STRUCTURED_ASSIGNMENT = re.compile(
    r"^\s*[\"']?(?P<name>[A-Za-z][A-Za-z0-9_.-]*)[\"']?\s*:\s*"
    r"(?P<value>.*?)\s*,?\s*$"
)

_NON_LITERAL_EXPRESSION = re.compile(
    r"[()[\]{}]|(?:^|\s)(?:and|or)(?:\s|$)|&&|\|\||=>",
    re.IGNORECASE,
)

_STRUCTURED_SUFFIXES = frozenset({".json", ".jsonc", ".yaml", ".yml", ".toml"})
_CODE_SOURCE_SUFFIXES = frozenset(
    {
        ".c",
        ".cc",
        ".cpp",
        ".cs",
        ".go",
        ".java",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".php",
        ".py",
        ".rb",
        ".rs",
        ".ts",
        ".tsx",
    }
)


@dataclass(frozen=True, order=True)
class Finding:
    path: str
    rule_id: str


@dataclass(frozen=True)
class IndexEntry:
    path: str
    object_id: str
    mode: str


class SafetyCheckError(RuntimeError):
    """Raised when the guard cannot safely inspect the requested Git scope."""


def run_git(
    root: str | None,
    arguments: list[str],
    *,
    input_bytes: bytes | None = None,
) -> bytes:
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        input=input_bytes,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise SafetyCheckError("A required Git index query failed.")
    return result.stdout


def repository_root() -> str:
    output = run_git(None, ["rev-parse", "--show-toplevel"])
    try:
        return output.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as error:
        raise SafetyCheckError("The repository root path is not valid UTF-8.") from error


def decode_git_path(raw_path: bytes) -> str:
    return raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")


def read_index(root: str) -> tuple[dict[str, IndexEntry], set[str]]:
    output = run_git(root, ["ls-files", "--stage", "-z"])
    entries: dict[str, IndexEntry] = {}
    unmerged: set[str] = set()

    for record in output.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, raw_object_id, raw_stage = metadata.split(b" ", 2)
            path = decode_git_path(raw_path)
            stage = int(raw_stage)
        except (ValueError, UnicodeError) as error:
            raise SafetyCheckError("The Git index contained an unreadable entry.") from error

        if stage != 0:
            unmerged.add(path)
            continue

        entries[path] = IndexEntry(
            path=path,
            object_id=raw_object_id.decode("ascii", errors="strict"),
            mode=mode.decode("ascii", errors="strict"),
        )

    return entries, unmerged


def selected_paths(root: str, scope: str, entries: dict[str, IndexEntry], unmerged: set[str]) -> set[str]:
    if scope == "tracked":
        return set(entries) | unmerged

    output = run_git(
        root,
        ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z", "--"],
    )
    return {decode_git_path(path) for path in output.split(b"\0") if path}


def path_policy_findings(path: str) -> list[Finding]:
    findings: list[Finding] = []
    normalized = str(PurePosixPath(path))
    basename = PurePosixPath(normalized).name

    if basename == ".env" or (basename.startswith(".env.") and normalized != ".env.example"):
        findings.append(Finding(normalized, "FORBIDDEN_ENV_FILE"))

    policy_roots = (
        ("input/", "FORBIDDEN_RUNTIME_INPUT"),
        ("output/", "FORBIDDEN_RUNTIME_OUTPUT"),
        ("tests/testing-files/", "FORBIDDEN_PRIVATE_TEST_FIXTURE"),
        ("tests/testing-scripts/results/", "FORBIDDEN_GENERATED_REPORT"),
    )
    for prefix, rule_id in policy_roots:
        if normalized.startswith(prefix) and normalized not in ALLOWED_POLICY_SENTINELS:
            findings.append(Finding(normalized, rule_id))

    return findings


def object_metadata(root: str, object_ids: list[str]) -> dict[str, tuple[str, int]]:
    if not object_ids:
        return {}

    query = "".join(f"{object_id}\n" for object_id in object_ids).encode("ascii")
    output = run_git(
        root,
        ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
        input_bytes=query,
    )
    metadata: dict[str, tuple[str, int]] = {}
    for line in output.splitlines():
        fields = line.decode("ascii", errors="strict").split()
        if len(fields) != 3:
            raise SafetyCheckError("Git could not describe an indexed object.")
        object_id, object_type, raw_size = fields
        try:
            metadata[object_id] = (object_type, int(raw_size))
        except ValueError as error:
            raise SafetyCheckError("Git reported an invalid indexed object size.") from error
    return metadata


def read_blobs(root: str, object_ids: list[str]) -> dict[str, bytes]:
    if not object_ids:
        return {}

    query = "".join(f"{object_id}\n" for object_id in object_ids).encode("ascii")
    output = run_git(root, ["cat-file", "--batch"], input_bytes=query)
    blobs: dict[str, bytes] = {}
    offset = 0

    for expected_object_id in object_ids:
        header_end = output.find(b"\n", offset)
        if header_end < 0:
            raise SafetyCheckError("Git returned a truncated indexed object header.")
        header = output[offset:header_end].decode("ascii", errors="strict").split()
        if len(header) != 3:
            raise SafetyCheckError("Git returned an unreadable indexed object header.")
        object_id, object_type, raw_size = header
        if object_id != expected_object_id or object_type != "blob":
            raise SafetyCheckError("Git returned an unexpected indexed object.")
        try:
            size = int(raw_size)
        except ValueError as error:
            raise SafetyCheckError("Git returned an invalid indexed blob size.") from error

        content_start = header_end + 1
        content_end = content_start + size
        if content_end >= len(output) or output[content_end : content_end + 1] != b"\n":
            raise SafetyCheckError("Git returned truncated indexed blob content.")
        blobs[object_id] = output[content_start:content_end]
        offset = content_end + 1

    return blobs


def is_probably_binary(content: bytes) -> bool:
    sample = content[:8192]
    if not sample:
        return False
    if b"\0" in sample:
        return True
    control_bytes = sum(byte < 9 or 13 < byte < 32 for byte in sample)
    return control_bytes / len(sample) > 0.30


def decode_text(content: bytes) -> str | None:
    if content.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return content.decode("utf-16", errors="replace")
    if content.startswith(codecs.BOM_UTF8):
        return content.decode("utf-8-sig", errors="replace")
    if is_probably_binary(content):
        return None
    return content.decode("utf-8", errors="replace")


def is_credential_name(name: str) -> bool:
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", name).upper().strip("_")
    return re.fullmatch(_CREDENTIAL_NAME, normalized) is not None


def normalize_assignment_value(raw_value: str) -> tuple[str, bool]:
    value = raw_value.strip().rstrip(",;").strip()
    quoted = len(value) >= 2 and value[0] in {"'", '"', "`"} and value[-1] == value[0]
    if quoted:
        value = value[1:-1].strip()
    return value, quoted


def looks_like_literal_secret(
    raw_value: str,
    *,
    code_expression_context: bool = False,
) -> bool:
    value, quoted = normalize_assignment_value(raw_value)
    lowered = value.casefold()
    if not value:
        return False

    placeholder_prefixes = (
        "example",
        "dummy",
        "test",
        "inert",
        "placeholder",
        "changeme",
        "change_me",
        "replace_me",
        "redacted",
        "your_",
        "your-",
    )
    if lowered.startswith(placeholder_prefixes) or lowered in {"none", "null", "unset", "not_set"}:
        return False

    expression_markers = (
        "${",
        "$(",
        "process.env",
        "os.environ",
        "getenv(",
        "secret(",
        "secrets.",
    )
    if any(marker in lowered for marker in expression_markers):
        return False
    if value.startswith(("<", "{{")):
        return False
    if code_expression_context and not quoted and _NON_LITERAL_EXPRESSION.search(value):
        return False
    if (
        code_expression_context
        and not quoted
        and re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$.[\]'\"]*", value)
    ):
        return False

    return len(value) >= 8


def content_findings(path: str, content: bytes) -> list[Finding]:
    findings: list[Finding] = []
    if any(marker in content for marker in _PRIVATE_MATERIAL_MARKERS):
        findings.append(Finding(path, "PRIVATE_KEY_MARKER"))

    text = decode_text(content)
    if text is None:
        return findings

    suffix = PurePosixPath(path).suffix.casefold()
    structured = suffix in _STRUCTURED_SUFFIXES
    code_expression_context = suffix in _CODE_SOURCE_SUFFIXES
    for line in text.splitlines():
        match = _ENV_OR_CODE_ASSIGNMENT.match(line)
        if match and looks_like_literal_secret(
            match.group("value"),
            code_expression_context=code_expression_context,
        ):
            findings.append(Finding(path, "HIGH_RISK_SECRET_ASSIGNMENT"))
            break

        if structured:
            match = _STRUCTURED_ASSIGNMENT.match(line)
            if (
                match
                and is_credential_name(match.group("name"))
                and looks_like_literal_secret(match.group("value"))
            ):
                findings.append(Finding(path, "HIGH_RISK_SECRET_ASSIGNMENT"))
                break

    return findings


def inspect(scope: str) -> tuple[list[Finding], int]:
    root = repository_root()
    entries, unmerged = read_index(root)
    paths = selected_paths(root, scope, entries, unmerged)
    findings: set[Finding] = set()
    inspectable_entries: list[IndexEntry] = []

    for path in sorted(paths):
        findings.update(path_policy_findings(path))
        if path in unmerged:
            findings.add(Finding(path, "UNMERGED_INDEX_ENTRY"))
            continue
        entry = entries.get(path)
        if entry is None:
            findings.add(Finding(path, "MISSING_INDEX_ENTRY"))
            continue
        inspectable_entries.append(entry)

    object_ids = sorted({entry.object_id for entry in inspectable_entries})
    metadata = object_metadata(root, object_ids)
    scannable_paths_by_object: dict[str, list[str]] = {}

    for entry in inspectable_entries:
        object_type, size = metadata.get(entry.object_id, ("missing", -1))
        if object_type != "blob" or size < 0:
            findings.add(Finding(entry.path, "NON_BLOB_INDEX_ENTRY"))
            continue
        if size > MAX_FILE_BYTES and entry.path not in LARGE_FILE_ALLOWLIST:
            findings.add(Finding(entry.path, "FILE_EXCEEDS_1_MIB"))
            continue
        scannable_paths_by_object.setdefault(entry.object_id, []).append(entry.path)

    blobs = read_blobs(root, sorted(scannable_paths_by_object))
    for object_id, paths_for_object in scannable_paths_by_object.items():
        content = blobs[object_id]
        for path in paths_for_object:
            findings.update(content_findings(path, content))

    return sorted(findings), len(paths)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan staged or tracked Git-index content for repository safety violations.",
        epilog=(
            "Files larger than 1 MiB fail unless listed by exact path in the narrow "
            "LARGE_FILE_ALLOWLIST. Findings print only a path and rule ID."
        ),
    )
    parser.add_argument("--scope", choices=("staged", "tracked"), required=True)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        findings, scanned_count = inspect(arguments.scope)
    except (OSError, SafetyCheckError, UnicodeError):
        print("Repository safety check could not complete safely.", file=sys.stderr)
        return 2

    if findings:
        print(f"Repository safety check failed with {len(findings)} finding(s).", file=sys.stderr)
        for finding in findings:
            print(
                f"path={json.dumps(finding.path, ensure_ascii=True)} rule={finding.rule_id}",
                file=sys.stderr,
            )
        return 1

    print(
        f"Repository safety OK: {scanned_count} {arguments.scope} indexed file(s); "
        f"limit={MAX_FILE_BYTES} bytes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
