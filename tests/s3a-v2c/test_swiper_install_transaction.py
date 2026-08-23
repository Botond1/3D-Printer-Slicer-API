"""Transactional tree replacement and stale-content tests for S3a-V2C."""

import hashlib
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

from swiper_test_support import (copy_package_tree, load_installer, make_orca_root,
                                 package_entries, synthetic_digest, write_archive)


class SwiperInstallTransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.installer = load_installer()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="s3a-v2c-install-")
        self.root = Path(self.temporary.name)
        self.orca = self.root / "orca"
        self.targets = make_orca_root(self.orca)
        self.archive = self.root / "swiper.tgz"
        entries = package_entries() + [("package/modules/nested.txt", b"nested", "file")]
        write_archive(self.archive, entries)

    def tearDown(self):
        self.temporary.cleanup()

    def install(self):
        with synthetic_digest(self.installer, self.archive):
            return self.installer.install_swiper_vendor(
                self.archive, self.orca, self.installer.EXPECTED_URL
            )

    def test_positive_exact_archive_replaces_both_trees_with_identical_critical_blobs(self):
        evidence = self.install()
        self.assertEqual(len(evidence), 2)
        for target in self.targets:
            self.assertFalse((target / "original.txt").exists())
            self.assertEqual(self.installer.validate_package(target)["package.json"],
                             self.installer.validate_package(self.targets[0])["package.json"])
            if os.name != "nt":
                for path in (target, *target.rglob("*")):
                    expected = 0o755 if path.is_dir() else 0o644
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), expected, str(path))
        for name in ("swiper-bundle.min.js", "swiper-bundle.min.css"):
            digests = [hashlib.sha256((target / name).read_bytes()).hexdigest() for target in self.targets]
            self.assertEqual(digests[0], digests[1], f"{name} differs between target trees")
        self.assertEqual(list((self.orca / "resources" / "web").glob(".swiper-vendor-*")), [])
        self.assertEqual(list((self.orca / "resources" / "web" / "include").glob(".swiper-vendor-backup")), [])
        self.assertEqual(list((self.orca / "resources" / "web" / "guide").glob(".swiper-vendor-backup")), [])

    def test_permission_normalization_covers_verified_staged_and_final_trees(self):
        normalizer = self.installer.normalize_tree_permissions
        with mock.patch.object(self.installer, "normalize_tree_permissions", wraps=normalizer) as observed:
            self.install()
        self.assertEqual(observed.call_count, 5)
        normalized = [Path(call.args[0]) for call in observed.call_args_list]
        self.assertTrue(all(target in normalized for target in self.targets))

    @unittest.skipIf(os.name == "nt", "POSIX permission mutation requires POSIX mode semantics")
    def test_omitting_permission_normalization_leaves_detectably_unsafe_directories(self):
        with mock.patch.object(self.installer, "normalize_tree_permissions", return_value=None):
            self.install()
        modes = [stat.S_IMODE(path.stat().st_mode)
                 for target in self.targets for path in (target, *target.rglob("*")) if path.is_dir()]
        self.assertTrue(any(mode != 0o755 for mode in modes))

    def test_partial_second_commit_failure_rolls_back_both_original_trees(self):
        real_replace = self.installer.os.replace
        stage_commits = 0

        def fail_second_stage(source, target):
            nonlocal stage_commits
            if Path(source).parent.name.startswith(".swiper-vendor-"):
                stage_commits += 1
                if stage_commits == 2:
                    raise OSError("synthetic second-target interruption")
            return real_replace(source, target)

        with synthetic_digest(self.installer, self.archive), mock.patch.object(
            self.installer.os, "replace", side_effect=fail_second_stage
        ), self.assertRaisesRegex(self.installer.VendorInstallError, "replacement failed"):
            self.installer.install_swiper_vendor(self.archive, self.orca, self.installer.EXPECTED_URL)
        self.assertEqual([(target / "original.txt").read_text(encoding="utf-8") for target in self.targets],
                         ["original-include", "original-guide"])

    def test_metadata_12_1_2_cannot_mask_an_old_js_or_css_blob(self):
        for name, content in (("swiper-bundle.min.js", b"synthetic-old-js"),
                              ("swiper-bundle.min.css", b"synthetic-old-css")):
            with self.subTest(name=name):
                package = self.root / f"old-{Path(name).suffix[1:]}"
                copy_package_tree(package)
                (package / name).write_bytes(content)
                old_hashes = dict(self.installer.OLD_BUNDLE_HASHES)
                old_hashes[name] = hashlib.sha256(content).hexdigest()
                with mock.patch.object(self.installer, "OLD_BUNDLE_HASHES", old_hashes), self.assertRaisesRegex(
                    self.installer.VendorInstallError, "old Swiper bundle hash"
                ):
                    self.installer.validate_package(package)

    def test_nested_7_2_0_metadata_is_rejected(self):
        package = self.root / "nested-old"
        copy_package_tree(package)
        nested = package / "nested"
        nested.mkdir()
        (nested / "package.json").write_text('{"name":"swiper","version":"7.2.0"}', encoding="utf-8")
        with self.assertRaisesRegex(self.installer.VendorInstallError, "old Swiper metadata"):
            self.installer.validate_package(package)

    def test_divergent_target_tree_is_detected_and_originals_are_restored(self):
        stages = (self.root / "stage-include", self.root / "stage-guide")
        copy_package_tree(stages[0], js=b"same-js")
        copy_package_tree(stages[1], js=b"different-js")
        hashes = self.installer.validate_package(stages[0])
        with self.assertRaisesRegex(self.installer.VendorInstallError, "critical Swiper blob hashes differ"):
            self.installer.replace_trees(self.targets, stages, hashes)
        self.assertTrue(all((target / "original.txt").exists() for target in self.targets))

    def test_staging_cleanup_failure_fails_closed(self):
        real_cleanup = self.installer.cleanup_tree

        def fail_staging_cleanup(path):
            if Path(path).name.startswith(".swiper-vendor-"):
                raise self.installer.VendorInstallError("synthetic cleanup failure")
            return real_cleanup(path)

        with synthetic_digest(self.installer, self.archive), mock.patch.object(
            self.installer, "cleanup_tree", side_effect=fail_staging_cleanup
        ), self.assertRaisesRegex(self.installer.VendorInstallError, "staging cleanup failed"):
            self.installer.install_swiper_vendor(self.archive, self.orca, self.installer.EXPECTED_URL)


if __name__ == "__main__":
    unittest.main()
