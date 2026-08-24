"""Mutation-style contracts for exact queue artifact cleanup evidence."""

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_ROOT = REPOSITORY_ROOT / "tests" / "testing-scripts"
sys.path.insert(0, str(SCRIPTS_ROOT))

from common import queue_cleanup_manifest as manifest  # noqa: E402


def record(index: int, **overrides) -> SimpleNamespace:
    values = {
        "job_id": f"job-{index:032x}",
        "artifact_id": f"artifact-{index:032x}",
        "raw_path": "/root/customer/private.stl",
        "raw_body": {"token": "never-serialize-this-secret"},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class CleanupManifestSerializationTests(unittest.TestCase):
    def test_schema_is_exact_sorted_and_secret_free(self) -> None:
        payload = manifest.serialize_cleanup_manifest([record(2), record(1)])
        document = json.loads(payload)
        self.assertEqual(set(document), {"schema_version", "artifacts"})
        self.assertEqual(document["schema_version"], manifest.CLEANUP_MANIFEST_SCHEMA)
        self.assertEqual(document["artifacts"], [
            {"job_id": f"job-{1:032x}", "artifact_id": f"artifact-{1:032x}"},
            {"job_id": f"job-{2:032x}", "artifact_id": f"artifact-{2:032x}"},
        ])
        decoded = payload.decode("ascii")
        self.assertNotIn("customer", decoded)
        self.assertNotIn("secret", decoded)

    def test_invalid_identity_and_collision_fail_closed(self) -> None:
        for override in (
            {"job_id": "job-../../private"}, {"artifact_id": "artifact-0"},
            {"job_id": None}, {"artifact_id": "artifact-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
        ):
            with self.subTest(override=override), self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_identity_invalid",
            ):
                manifest.serialize_cleanup_manifest([record(1, **override)])
        for values in (
            [record(1), record(2, job_id=f"job-{1:032x}")],
            [record(1), record(2, artifact_id=f"artifact-{1:032x}")],
        ):
            with self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_identity_collision",
            ):
                manifest.serialize_cleanup_manifest(values)

    def test_record_and_byte_bounds_fail_closed(self) -> None:
        with mock.patch.object(manifest, "MAX_CLEANUP_MANIFEST_RECORDS", 2), self.assertRaisesRegex(
            manifest.CleanupManifestError, "cleanup_manifest_record_limit_exceeded",
        ):
            manifest.serialize_cleanup_manifest([record(1), record(2), record(3)])
        with mock.patch.object(manifest, "MAX_CLEANUP_MANIFEST_BYTES", 32), self.assertRaisesRegex(
            manifest.CleanupManifestError, "cleanup_manifest_size_exceeded",
        ):
            manifest.serialize_cleanup_manifest([record(1)])


class CreateNewWriterTests(unittest.TestCase):
    def test_hard_link_commit_is_bounded_private_and_consumable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "cleanup.json"
            original_link = os.link
            writer = manifest.CleanupManifestWriter.prepare(str(target))
            temporary = writer.temporary
            with mock.patch.object(manifest.os, "link", wraps=original_link) as link:
                byte_count = writer.publish([record(1)])
            link.assert_called_once_with(temporary, target, follow_symlinks=False)
            self.assertEqual(writer.state, "committed")
            self.assertFalse(temporary.exists())
            self.assertLessEqual(byte_count, manifest.MAX_CLEANUP_MANIFEST_BYTES)
            self.assertTrue(manifest.valid_cleanup_pair(
                **json.loads(target.read_text(encoding="ascii"))["artifacts"][0],
            ))
            mode = stat.S_IMODE(target.stat().st_mode)
            self.assertEqual(mode & 0o111, 0)
            if os.name != "nt":
                self.assertEqual(mode, 0o600)

    def test_generic_report_writer_uses_same_create_new_policy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "report.md"
            writer = manifest.CreateNewFileWriter.prepare(str(target), 32)
            self.assertEqual(writer.publish_bytes(b"bounded\n"), 8)
            self.assertEqual(target.read_bytes(), b"bounded\n")
            self.assertEqual(writer.state, "committed")

    def test_existing_target_and_invalid_parent_fail_before_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "cleanup.json"
            target.write_text("operator-owned", encoding="ascii")
            with self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_target_exists",
            ):
                manifest.CleanupManifestWriter.prepare(str(target))
            self.assertEqual(target.read_text(encoding="ascii"), "operator-owned")
            non_directory = Path(directory) / "not-a-directory"
            non_directory.write_text("owner-data", encoding="ascii")
            with self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_parent_invalid",
            ):
                manifest.CreateNewFileWriter.prepare(str(non_directory / "report.md"), 32)

    def test_report_parent_symlink_or_reparse_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            with mock.patch.object(manifest, "_is_link_or_reparse", return_value=True), self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_parent_invalid",
            ):
                manifest.CreateNewFileWriter.prepare(str(parent / "report.md"), 32)

    def test_after_check_race_cannot_replace_owner_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "cleanup.json"
            writer = manifest.CleanupManifestWriter.prepare(str(target))
            original_link = os.link

            def collide(source, destination, **kwargs):
                target.write_text("late-owner", encoding="ascii")
                return original_link(source, destination, **kwargs)

            with mock.patch.object(manifest.os, "link", side_effect=collide), self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_target_exists",
            ):
                writer.publish([record(1)])
            self.assertEqual(target.read_text(encoding="ascii"), "late-owner")
            self.assertFalse(writer.temporary.exists())

    def test_serialization_and_partial_write_remove_only_owned_temp(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "cleanup.json"
            writer = manifest.CleanupManifestWriter.prepare(str(target))
            with self.assertRaises(manifest.CleanupManifestError):
                writer.publish([record(1, artifact_id="invalid")])
            self.assertFalse(target.exists())
            self.assertFalse(writer.temporary.exists())

            second = manifest.CleanupManifestWriter.prepare(str(target))
            second.writer.handle.close()
            second.writer.handle = mock.Mock(closed=False)
            second.writer.handle.write.return_value = 1
            with self.assertRaisesRegex(
                manifest.CleanupManifestError, "cleanup_manifest_write_incomplete",
            ):
                second.publish([record(1)])
            second.writer.handle.close.assert_called_once()
            self.assertFalse(target.exists())
            self.assertFalse(second.temporary.exists())

    def _assert_committed_uncertain(self, fault: str, expected_stage: str) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "cleanup.json"
            writer = manifest.CleanupManifestWriter.prepare(str(target))
            if fault == "fchmod":
                patch_target, attribute = manifest.os, "fchmod"
            elif fault == "_unlink_owned_temporary":
                patch_target, attribute = writer.writer, fault
            else:
                patch_target, attribute = manifest, fault
            with mock.patch.object(patch_target, attribute, side_effect=OSError("synthetic")):
                with self.assertRaises(manifest.CreateNewPublicationError) as raised:
                    writer.publish([record(1)])
            self.assertEqual(raised.exception.state, "committed_uncertain")
            self.assertEqual(raised.exception.stage, expected_stage)
            self.assertEqual(writer.state, "committed_uncertain")
            self.assertTrue(target.exists())
            self.assertEqual(json.loads(target.read_text(encoding="ascii"))["artifacts"][0], {
                "job_id": f"job-{1:032x}", "artifact_id": f"artifact-{1:032x}",
            })
            writer.abort()
            self.assertTrue(target.exists())

    def test_post_link_chmod_and_temp_unlink_failures_preserve_target(self) -> None:
        self._assert_committed_uncertain("fchmod", "post_link_chmod")
        self._assert_committed_uncertain("_unlink_owned_temporary", "post_link_temp_unlink")

    def test_post_link_parent_fsync_failure_preserves_target(self) -> None:
        self._assert_committed_uncertain("_fsync_parent", "post_link_parent_fsync")


if __name__ == "__main__":
    unittest.main()
