#!/usr/bin/env python3
"""CLI entrypoint for the Git-index repository safety guard."""

from __future__ import annotations

from repository_safety import cli_main


if __name__ == "__main__":
    raise SystemExit(cli_main())
