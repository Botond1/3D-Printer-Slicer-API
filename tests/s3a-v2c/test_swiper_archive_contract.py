"""Fail-closed archive and provenance mutations for the Swiper installer."""

from pathlib import Path
import tempfile
import unittest
from unittest import mock

from swiper_test_support import load_installer, package_entries, synthetic_digest, write_archive


class SwiperArchiveContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.installer = load_installer()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="s3a-v2c-archive-")
        self.root = Path(self.temporary.name)
        self.archive = self.root / "swiper.tgz"

    def tearDown(self):
        self.temporary.cleanup()

    def verify(self, entries, *, source_url=None, patch_digest=True):
        write_archive(self.archive, entries)
        destination = self.root / f"extract-{len(list(self.root.glob('extract-*')))}"
        context = synthetic_digest(self.installer, self.archive) if patch_digest else mock.patch.object(
            self.installer, "EXPECTED_SHA256", "0" * 64
        )
        with context:
            return self.installer.verify_archive(
                self.archive, source_url or self.installer.EXPECTED_URL, destination
            )

    def assert_rejected(self, entries, pattern, **kwargs):
        with self.assertRaisesRegex(self.installer.VendorInstallError, pattern):
            self.verify(entries, **kwargs)

    def test_wrong_sha256_is_rejected(self):
        self.assert_rejected(package_entries(), "SHA256 mismatch", patch_digest=False)

    def test_wrong_sha512_is_rejected_after_sha256_matches(self):
        write_archive(self.archive, package_entries())
        sha256 = __import__("hashlib").sha256(self.archive.read_bytes()).hexdigest()
        with mock.patch.object(self.installer, "EXPECTED_SHA256", sha256), self.assertRaisesRegex(
            self.installer.VendorInstallError, "SHA512 integrity mismatch"
        ):
            self.installer.verify_archive(self.archive, self.installer.EXPECTED_URL, self.root / "extract")

    def test_version_mismatch_is_rejected(self):
        package = self.verify(package_entries(version="12.1.1"))
        with self.assertRaisesRegex(self.installer.VendorInstallError, "name/version"):
            self.installer.validate_package(package)

    def test_floating_redirected_or_wrong_version_urls_are_rejected(self):
        for url in (
            "https://registry.npmjs.org/swiper/-/swiper-latest.tgz",
            "https://example.invalid/redirect/swiper-12.1.2.tgz",
            "https://registry.npmjs.org/swiper/-/swiper-12.1.3.tgz",
        ):
            with self.subTest(url=url):
                self.assert_rejected(package_entries(), "source URL", source_url=url)

    def test_absolute_parent_backslash_and_drive_paths_are_rejected(self):
        for unsafe in ("/package/escape", "package/../escape", "package\\escape", "C:/package/escape"):
            with self.subTest(path=unsafe):
                self.assert_rejected([(unsafe, b"x", "file")], "unsafe path|outside package")

    def test_unexpected_root_duplicate_symlink_and_hardlink_are_rejected(self):
        mutations = (
            ([("other/file", b"x", "file")], "outside package"),
            ([("package/file", b"a", "file"), ("package/file", b"b", "file")], "duplicate"),
            ([("package/link", b"target", "symlink")], "type is not allowed"),
            ([("package/link", b"package/target", "hardlink")], "type is not allowed"),
        )
        for entries, pattern in mutations:
            with self.subTest(pattern=pattern):
                self.assert_rejected(entries, pattern)

    def test_missing_js_css_and_license_are_rejected(self):
        for missing in ("swiper-bundle.min.js", "swiper-bundle.min.css", "LICENSE"):
            with self.subTest(missing=missing):
                package = self.verify(package_entries(missing=missing))
                with self.assertRaisesRegex(self.installer.VendorInstallError, "required Swiper file"):
                    self.installer.validate_package(package)

    def test_entry_count_and_cumulative_size_limits_are_rejected(self):
        with mock.patch.object(self.installer, "MAX_ARCHIVE_ENTRIES", 3):
            self.assert_rejected(package_entries(), "entry count")
        with mock.patch.object(self.installer, "MAX_UNCOMPRESSED_BYTES", 3):
            self.assert_rejected([("package/large", b"1234", "file")], "uncompressed size")

    def test_compressed_archive_size_limit_is_rejected_before_processing(self):
        with mock.patch.object(self.installer, "MAX_ARCHIVE_BYTES", 1):
            self.assert_rejected(package_entries(), "compressed size")


if __name__ == "__main__":
    unittest.main()
