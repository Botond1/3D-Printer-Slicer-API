#!/usr/bin/env python3
"""Move the slicer's legacy shared slice key into the WooCommerce principal's
previous slot (3.9.0 §6, ruling R7). Names only: no key value is ever printed.

What it does to the service env file (docker ``--env-file`` format,
``NAME=value`` per line, values taken literally):

* ``SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS`` := the exact bytes of the
  value of ``SLICE_SERVICE_API_KEY``;
* deletes ``SLICE_SERVICE_API_KEY``, ``SLICE_SERVICE_API_KEY_PREVIOUS`` and
  ``SLICE_SERVICE_LEGACY_MIGRATION_UNTIL``;
* sets ``SLICE_SERVICE_AUTH_MODE=principals``.

Every other line (comments, blank lines, order, line endings) is kept byte for
byte. The file is rewritten atomically (temporary file in the same directory,
``fsync``, ``rename``) with mode 0600, keeping the owner where it can.

Refusals (nothing is written, exit 2): the WooCommerce previous slot already
holds a value (also how a second run is recognised: exit 3, "already
migrated"), no legacy key, a WooCommerce or LeadPilot active key missing (the
result would refuse to start), the legacy key equal to another slot's value,
a duplicated or unparseable line among the names it touches, or a value that
is not printable ASCII.

The 3.8.3 validator accepts the result (``service-auth.js``: principals mode,
both principals active, any previous slot valid), so it is also the rollback
state.

Usage: ``migrate-legacy-to-principal.py --env-file PATH [--dry-run]``.
Output: the names that change and the verdict. Exit 0 migrated (or would be,
with ``--dry-run``), 2 refused, 3 already migrated.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from dataclasses import dataclass

LEGACY_ACTIVE = "SLICE_SERVICE_API_KEY"
LEGACY_PREVIOUS = "SLICE_SERVICE_API_KEY_PREVIOUS"
MIGRATION_UNTIL = "SLICE_SERVICE_LEGACY_MIGRATION_UNTIL"
AUTH_MODE = "SLICE_SERVICE_AUTH_MODE"
WOO_ACTIVE = "SLICE_SERVICE_WOOCOMMERCE_API_KEY"
WOO_PREVIOUS = "SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS"
LEAD_ACTIVE = "SLICE_SERVICE_LEADPILOT_API_KEY"
PRINCIPALS = "principals"

EXIT_OK = 0
EXIT_REFUSED = 2
EXIT_ALREADY_MIGRATED = 3

TOUCHED = (LEGACY_ACTIVE, LEGACY_PREVIOUS, MIGRATION_UNTIL, AUTH_MODE, WOO_ACTIVE, WOO_PREVIOUS, LEAD_ACTIVE)
ASSIGNMENT = re.compile(rb"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)
PRINTABLE = re.compile(rb"^[\x20-\x7e]*$")


class Refusal(Exception):
    """A precondition failed; carries a names-only message and an exit code."""

    def __init__(self, message: str, code: int = EXIT_REFUSED) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Line:
    body: bytes
    ending: bytes
    name: str | None = None
    value: bytes | None = None


def split_lines(data: bytes) -> list[Line]:
    lines: list[Line] = []
    for raw in data.splitlines(keepends=True):
        if raw.endswith(b"\r\n"):
            body, ending = raw[:-2], b"\r\n"
        elif raw.endswith(b"\n") or raw.endswith(b"\r"):
            body, ending = raw[:-1], raw[-1:]
        else:
            body, ending = raw, b""
        line = Line(body=body, ending=ending)
        stripped = body.lstrip()
        if stripped and not stripped.startswith(b"#"):
            match = ASSIGNMENT.match(body)
            if match:
                line.name = match.group(1).decode("ascii")
                line.value = match.group(2)
            elif any(name.encode("ascii") in body for name in TOUCHED):
                # e.g. `export NAME=…` or `NAME = …`: not a form docker reads the same way.
                raise Refusal("a key-ring line is not in plain NAME=value form")
        lines.append(line)
    return lines


def index_of(lines: list[Line], name: str) -> int | None:
    found = [position for position, line in enumerate(lines) if line.name == name]
    if len(found) > 1:
        raise Refusal(f"{name} appears more than once")
    return found[0] if found else None


def value_of(lines: list[Line], name: str) -> bytes:
    position = index_of(lines, name)
    return b"" if position is None else lines[position].value or b""


def plan(lines: list[Line]) -> tuple[list[Line], list[str]]:
    """Return the rewritten lines and the names-only change list, or raise Refusal."""
    for name in TOUCHED:
        index_of(lines, name)  # duplicates refuse
        value = value_of(lines, name)
        if not PRINTABLE.match(value):
            raise Refusal(f"{name} holds a value that is not printable ASCII")

    legacy = value_of(lines, LEGACY_ACTIVE)
    woo_previous = value_of(lines, WOO_PREVIOUS)
    if woo_previous:
        if not legacy and value_of(lines, AUTH_MODE) == PRINCIPALS.encode("ascii"):
            raise Refusal(f"already migrated: {WOO_PREVIOUS} is set and {LEGACY_ACTIVE} is absent",
                          EXIT_ALREADY_MIGRATED)
        raise Refusal(f"{WOO_PREVIOUS} already holds a value; nothing is overwritten")
    if not legacy:
        raise Refusal(f"{LEGACY_ACTIVE} is absent or empty; there is no legacy key to move")
    if not value_of(lines, WOO_ACTIVE) or not value_of(lines, LEAD_ACTIVE):
        raise Refusal(f"{WOO_ACTIVE} and {LEAD_ACTIVE} must both be set for principals mode")
    for name, line in ((line.name, line) for line in lines if line.name):
        if name != LEGACY_ACTIVE and line.value == legacy:
            raise Refusal(f"the legacy key equals the value of {name}; every slot must be unique")

    changes: list[str] = []
    result: list[Line] = []
    default_ending = next((line.ending for line in lines if line.ending), b"\n")
    for line in lines:
        if line.name in (LEGACY_ACTIVE, LEGACY_PREVIOUS, MIGRATION_UNTIL):
            changes.append(f"deleted {line.name}")
            continue
        if line.name == WOO_PREVIOUS:
            result.append(Line(body=WOO_PREVIOUS.encode("ascii") + b"=" + legacy, ending=line.ending or default_ending,
                               name=WOO_PREVIOUS, value=legacy))
            changes.append(f"set {WOO_PREVIOUS} (moved from {LEGACY_ACTIVE})")
            continue
        if line.name == AUTH_MODE:
            if line.value != PRINCIPALS.encode("ascii"):
                changes.append(f"set {AUTH_MODE}=principals")
            result.append(Line(body=AUTH_MODE.encode("ascii") + b"=" + PRINCIPALS.encode("ascii"),
                               ending=line.ending or default_ending, name=AUTH_MODE, value=PRINCIPALS.encode("ascii")))
            continue
        result.append(line)
        if line.name == WOO_ACTIVE and index_of(lines, WOO_PREVIOUS) is None:
            if not line.ending:
                line.ending = default_ending
            result.append(Line(body=WOO_PREVIOUS.encode("ascii") + b"=" + legacy, ending=default_ending,
                               name=WOO_PREVIOUS, value=legacy))
            changes.append(f"set {WOO_PREVIOUS} (moved from {LEGACY_ACTIVE})")
    if index_of(lines, AUTH_MODE) is None:
        if result and not result[-1].ending:
            result[-1].ending = default_ending
        result.append(Line(body=AUTH_MODE.encode("ascii") + b"=" + PRINCIPALS.encode("ascii"), ending=default_ending,
                           name=AUTH_MODE, value=PRINCIPALS.encode("ascii")))
        changes.append(f"set {AUTH_MODE}=principals")
    return result, changes


def write_atomically(path: str, data: bytes) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    try:
        original = os.stat(path)
    except OSError:
        original = None
    descriptor, temporary = tempfile.mkstemp(prefix=".keyring-migration-", suffix=".tmp", dir=directory)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if original is not None and hasattr(os, "chown"):
            try:
                os.chown(temporary, original.st_uid, original.st_gid)
            except OSError:
                pass
        os.replace(temporary, path)
        os.chmod(path, 0o600)
        if hasattr(os, "O_DIRECTORY"):
            directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def migrate(path: str, dry_run: bool = False) -> tuple[int, list[str]]:
    with open(path, "rb") as handle:
        data = handle.read()
    lines = split_lines(data)
    result, changes = plan(lines)
    if not dry_run:
        write_atomically(path, b"".join(line.body + line.ending for line in result))
    return EXIT_OK, changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Move the legacy slice key into the WooCommerce previous slot.")
    parser.add_argument("--env-file", required=True, help="the slicer service env file (rewritten in place)")
    parser.add_argument("--dry-run", action="store_true", help="print the names that would change; write nothing")
    arguments = parser.parse_args(argv)
    try:
        code, changes = migrate(arguments.env_file, arguments.dry_run)
    except Refusal as refusal:
        print(f"REFUSED: {refusal}", file=sys.stderr)
        return refusal.code
    except OSError as error:
        print(f"REFUSED: the env file could not be read or written ({error.__class__.__name__})", file=sys.stderr)
        return EXIT_REFUSED
    for change in changes:
        print(change)
    print("DRY RUN: nothing written" if arguments.dry_run else "MIGRATED: the env file was rewritten (mode 0600)")
    return code


if __name__ == "__main__":
    sys.exit(main())
