"""Exact production pin and import-safe source contracts for S3a-V2C."""

from pathlib import Path
import subprocess
import sys
import unittest

from swiper_test_support import INSTALLER_PATH, ROOT, load_installer


class SwiperSourceContractTests(unittest.TestCase):
    def test_production_provenance_constants_are_exact(self):
        module = load_installer()
        self.assertEqual(module.EXPECTED_VERSION, "12.1.2")
        self.assertEqual(module.EXPECTED_URL, "https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz")
        self.assertEqual(module.EXPECTED_SHA256,
                         "7780a8143baf0f021fcc3de927cc95c6b79e8fdc6d38e1f5ba2d0ed17d943457")
        self.assertEqual(module.EXPECTED_SHA512,
                         "e2020bac8def5d9aa8661ef52353c02eaba4085824fa0a4ec1ed6d3afcf9b84f"
                         "641ed9768130f39987e5602c16bd1e0b3af0ab262e9410453e827b96e41b6481")
        self.assertEqual(module.OLD_BUNDLE_HASHES["swiper-bundle.min.js"],
                         "62eb35c7dfb8f9d5bf358c805f3c8063fda32dbf0a81608f2179e8af2ca4ad0e")
        self.assertEqual(module.MAX_ARCHIVE_ENTRIES, 512)
        self.assertEqual(module.MAX_UNCOMPRESSED_BYTES, 16 * 1024 * 1024)

    def test_installer_is_import_safe_and_cli_requires_all_exact_inputs(self):
        result = subprocess.run(
            [sys.executable, "-c", f"import runpy; runpy.run_path({str(INSTALLER_PATH)!r}, run_name='test_import')"],
            cwd=ROOT, check=False, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        source = INSTALLER_PATH.read_text(encoding="utf-8")
        for option in ("--archive", "--orca-root", "--bambu-root", "--source-url"):
            self.assertIn(f'add_argument("{option}", required=True', source)
        self.assertIn('if __name__ == "__main__":', source)
        # Both extracted trees are remediated by one pinned installer run.
        self.assertIn('{"orca": arguments.orca_root, "bambu": arguments.bambu_root}', source)

    def test_archive_member_limit_is_enforced_while_streaming(self):
        source = INSTALLER_PATH.read_text(encoding="utf-8")
        self.assertNotIn("archive.getmembers()", source)
        self.assertIn("for member in archive:", source)
        self.assertIn("if len(members) > MAX_ARCHIVE_ENTRIES:", source)

    def test_dockerfile_keeps_orca_pin_and_uses_exact_swiper_installer_contract(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn(
            'ARG ORCA_APPIMAGE_URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/'
            'v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage"', dockerfile,
        )
        self.assertIn(
            'ARG ORCA_APPIMAGE_SHA256="f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701"',
            dockerfile,
        )
        self.assertIn(
            'ARG SWIPER_VENDOR_URL="https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz"', dockerfile,
        )
        self.assertRegex(dockerfile, r'install-swiper-vendor\.py[\s\\]+--archive[\s\\]+/tmp/swiper-12\.1\.2\.tgz')
        self.assertRegex(dockerfile, r'--orca-root[\s\\]+/tmp/orca-squashfs-root')
        self.assertRegex(dockerfile, r'--bambu-root[\s\\]+/tmp/bambu-squashfs-root')
        self.assertRegex(dockerfile, r'--source-url[\s\\]+"\$SWIPER_VENDOR_URL"')
        # The Bambu tree is remediated after extraction and before the AppImages are removed.
        self.assertLess(dockerfile.index("mv squashfs-root bambu-squashfs-root"), dockerfile.index("--bambu-root"))
        self.assertLess(dockerfile.index("--bambu-root"), dockerfile.index("rm -- /tmp/PrusaSlicer.AppImage"))


if __name__ == "__main__":
    unittest.main()
