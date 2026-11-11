"""CLI-level tests for ops/hostinger/keyring/migrate-legacy-to-principal.py (3.9.0 §6, T-AUTH).

Fixture env files only; every value is generated per run and never written to
the repository. The script must move the legacy value byte for byte, print
names only, refuse a second run, and leave mode 0600.
"""

import os
import secrets
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "ops" / "hostinger" / "keyring" / "migrate-legacy-to-principal.py"

LEGACY = "SLICE_SERVICE_API_KEY"
LEGACY_PREV = LEGACY + "_PREVIOUS"
UNTIL = "SLICE_SERVICE_LEGACY_MIGRATION_UNTIL"
MODE = "SLICE_SERVICE_AUTH_MODE"
WOO = "SLICE_SERVICE_WOOCOMMERCE_API_KEY"
WOO_PREV = WOO + "_PREVIOUS"
LEAD = "SLICE_SERVICE_LEADPILOT_API_KEY"


def fake_value(length=64):
    return secrets.token_hex(length // 2)


def render(pairs, ending="\n"):
    lines = []
    for item in pairs:
        lines.append(item if isinstance(item, str) else "=".join(item))
    return (ending.join(lines) + ending).encode("ascii")


def parse(data):
    values = {}
    for raw in data.decode("ascii").splitlines():
        if raw and not raw.startswith("#") and "=" in raw:
            name, value = raw.split("=", 1)
            values[name] = value
    return values


class KeyringMigrationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.values = {
            LEGACY: fake_value(64),
            LEGACY_PREV: fake_value(64),
            WOO: fake_value(48),
            LEAD: fake_value(48),
            "OPERATIONS_API_KEY": fake_value(48),
        }
        self.path = Path(self.directory.name) / "slicer.env"

    def write(self, pairs, ending="\n"):
        self.path.write_bytes(render(pairs, ending))
        if os.name != "nt":
            os.chmod(self.path, 0o640)

    def live_like(self):
        return [
            "# rocket3d slicer service env (fixture)",
            ("NODE_ENV", "production"),
            ("MAX_CONCURRENT_SLICES", "2"),
            (LEGACY, self.values[LEGACY]),
            (LEGACY_PREV, self.values[LEGACY_PREV]),
            (WOO, self.values[WOO]),
            (LEAD, self.values[LEAD]),
            (MODE, "migration"),
            (UNTIL, "2026-11-30T00:00:00.000Z"),
            "",
            ("OPERATIONS_API_KEY", self.values["OPERATIONS_API_KEY"]),
            ("SLICE_RATE_LIMIT_MAX_REQUESTS", "30"),
        ]

    def run_script(self, *extra):
        return subprocess.run(
            [sys.executable, "-I", str(SCRIPT), "--env-file", str(self.path), *extra],
            capture_output=True, text=True, check=False, timeout=60,
        )

    def assert_no_value_printed(self, result):
        output = result.stdout + result.stderr
        for value in self.values.values():
            self.assertNotIn(value, output)
            self.assertNotIn(value[:12], output)

    def test_moves_the_legacy_bytes_and_keeps_every_other_line(self):
        self.write(self.live_like())
        before = self.path.read_bytes()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_value_printed(result)
        self.assertIn(f"deleted {LEGACY}", result.stdout)
        self.assertIn(f"set {WOO_PREV} (moved from {LEGACY})", result.stdout)
        after = self.path.read_bytes()
        values = parse(after)
        self.assertEqual(values[WOO_PREV].encode("ascii"), self.values[LEGACY].encode("ascii"))
        for removed in (LEGACY, LEGACY_PREV, UNTIL):
            self.assertNotIn(removed, values)
        self.assertEqual(values[MODE], "principals")
        self.assertEqual(values[WOO], self.values[WOO])
        self.assertEqual(values[LEAD], self.values[LEAD])
        # Every untouched line survives byte for byte and in order.
        untouched = [line for line in before.split(b"\n")
                     if not line.startswith((LEGACY.encode(), UNTIL.encode(), MODE.encode()))]
        kept = [line for line in after.split(b"\n")
                if not line.startswith((WOO_PREV.encode(), MODE.encode()))]
        self.assertEqual(untouched, kept)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        leftovers = [name for name in os.listdir(self.directory.name) if name != "slicer.env"]
        self.assertEqual(leftovers, [])

    def test_second_run_is_refused_and_changes_nothing(self):
        self.write(self.live_like())
        self.assertEqual(self.run_script().returncode, 0)
        migrated = self.path.read_bytes()
        second = self.run_script()
        self.assertEqual(second.returncode, 3)
        self.assertIn("already migrated", second.stderr)
        self.assert_no_value_printed(second)
        self.assertEqual(self.path.read_bytes(), migrated)

    def test_refuses_when_the_woocommerce_previous_slot_already_holds_a_value(self):
        pairs = self.live_like()
        pairs.insert(6, (WOO_PREV, fake_value(48)))
        self.write(pairs)
        before = self.path.read_bytes()
        result = self.run_script()
        self.assertEqual(result.returncode, 2)
        self.assertIn(WOO_PREV, result.stderr)
        self.assert_no_value_printed(result)
        self.assertEqual(self.path.read_bytes(), before)

    def test_an_empty_previous_line_is_filled_in_place_and_crlf_endings_kept(self):
        pairs = self.live_like()
        pairs.insert(6, (WOO_PREV, ""))
        self.write(pairs, ending="\r\n")
        self.assertEqual(self.run_script().returncode, 0)
        after = self.path.read_bytes()
        self.assertNotIn(b"\n", after.replace(b"\r\n", b""))
        self.assertEqual(after.count(WOO_PREV.encode()), 1)
        self.assertEqual(parse(after)[WOO_PREV], self.values[LEGACY])

    def test_dry_run_prints_names_and_writes_nothing(self):
        self.write(self.live_like())
        before = self.path.read_bytes()
        result = self.run_script("--dry-run")
        self.assertEqual(result.returncode, 0)
        self.assertIn("DRY RUN", result.stdout)
        self.assert_no_value_printed(result)
        self.assertEqual(self.path.read_bytes(), before)

    def test_refusals_leave_the_file_untouched(self):
        cases = {
            "no legacy key": [p for p in self.live_like() if not (isinstance(p, tuple) and p[0] == LEGACY)],
            "no leadpilot key": [p for p in self.live_like() if not (isinstance(p, tuple) and p[0] == LEAD)],
            "duplicate name": self.live_like() + [(WOO, fake_value(48))],
            "legacy equals another slot": [
                (LEGACY, self.values[WOO]) if isinstance(p, tuple) and p[0] == LEGACY else p
                for p in self.live_like()
            ],
            "export form": self.live_like() + [f"export {WOO_PREV}=x"],
        }
        for label, pairs in cases.items():
            with self.subTest(label):
                self.write(pairs)
                before = self.path.read_bytes()
                result = self.run_script()
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertTrue(result.stderr.startswith("REFUSED"))
                self.assert_no_value_printed(result)
                self.assertEqual(self.path.read_bytes(), before)

    def test_appends_the_mode_and_slot_when_the_file_has_neither(self):
        self.write([(LEGACY, self.values[LEGACY]), (WOO, self.values[WOO]), (LEAD, self.values[LEAD])])
        self.assertEqual(self.run_script().returncode, 0)
        values = parse(self.path.read_bytes())
        self.assertEqual(values, {
            WOO: self.values[WOO],
            WOO_PREV: self.values[LEGACY],
            LEAD: self.values[LEAD],
            MODE: "principals",
        })

    def test_the_result_is_accepted_by_the_service_validator(self):
        node = shutil_which("node")
        if node is None:
            self.skipTest("node is not on PATH")
        self.write(self.live_like() + [
            ("PRICING_API_KEY", fake_value(48)), ("ARTIFACT_API_KEY", fake_value(48)),
        ])
        self.assertEqual(self.run_script().returncode, 0)
        program = (
            "const fs=require('fs');const {resolveServiceKeyRing}=require(process.argv[1]);"
            "const env={};for(const l of fs.readFileSync(process.argv[2],'utf8').split(/\\r?\\n/)){"
            "if(!l||l.startsWith('#'))continue;const i=l.indexOf('=');env[l.slice(0,i)]=l.slice(i+1);}"
            "const r=resolveServiceKeyRing(env,{now:Date.parse('2026-12-01T00:00:00Z')});"
            "process.stdout.write(r.sliceCredentialMode.mode+' '+(r.audiences.slice.principals.woocommerce.previous===env."
            + WOO_PREV + "));"
        )
        result = subprocess.run(
            [node, "-e", program, str(ROOT / "app" / "config" / "service-auth.js"), str(self.path)],
            capture_output=True, text=True, check=False, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "principals true")


def shutil_which(name):
    import shutil
    return shutil.which(name)


if __name__ == "__main__":
    unittest.main()
