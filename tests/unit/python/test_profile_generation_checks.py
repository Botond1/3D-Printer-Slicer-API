import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "testing-scripts"))
from common.profile_generation_checks import BAMBU_FIELDS, generation_shape, material_parity_digest, v2_projection


class ProfileGenerationChecksTests(unittest.TestCase):
    def test_bambu_requires_all_three_valid_identity_fields(self):
        row = {"engine": "bambu", **{key: "a" * 64 for key in BAMBU_FIELDS}}
        self.assertTrue(generation_shape(row, {"engine"}))
        for key in BAMBU_FIELDS:
            for invalid in [None, "A" * 64, "a" * 63, 123]:
                with self.subTest(key=key, invalid=invalid):
                    self.assertFalse(generation_shape({**row, key: invalid}, {"engine"}))
            missing = dict(row)
            missing.pop(key)
            self.assertFalse(generation_shape(missing, {"engine"}))
        self.assertFalse(generation_shape({**row, "unexpected": 1}, {"engine"}))

    def test_non_bambu_preserves_exact_shape(self):
        self.assertTrue(generation_shape({"engine": "prusa"}, {"engine"}))
        self.assertFalse(generation_shape({"engine": "prusa", "measurement_generation": "a" * 64}, {"engine"}))

    def fixture(self):
        generic = {"id": "prusa:P1S", "effective_profile_sha256": "a" * 64}
        variant = {"material": "PLA", "supports": True, "effective_profile_sha256": "b" * 64, "filament_density_g_cm3": 1.24}
        body = {"schema": "r3d-profile-catalogue-v3", "profiles": [{**generic, "material_profiles": {"schema": "r3d-prusa-material-profiles-v1", "profiles": [variant]}}]}
        return generic, body

    def test_material_identity_is_distinct_from_generic(self):
        generic, body = self.fixture()
        self.assertEqual(material_parity_digest(body, generic, "PLA"), "b" * 64)
        self.assertIsNone(material_parity_digest(body, generic, "PETG"))

    def test_stale_or_duplicate_outer_row_is_rejected(self):
        generic, body = self.fixture()
        for candidate in [{**body, "schema": "r3d-profile-catalogue-v2"}, {**body, "profiles": body["profiles"] * 2}]:
            self.assertIsNone(material_parity_digest(candidate, generic, "PLA"))
        body["profiles"][0]["effective_profile_sha256"] = "c" * 64
        self.assertIsNone(material_parity_digest(body, generic, "PLA"))

    def test_v3_only_build_volume_field_is_not_part_of_the_v2_row(self):
        # 3.7.0: every v3 row carries alternative_footprints_inclusive_mm; v2 omits it.
        generic, body = self.fixture()
        limits = {"largest_passing_dimensions_inclusive_mm": {"x": 256, "y": 256, "z": 249.9}, "source_profile": "FDM_0.2mm.ini"}
        generic["build_volume_limits_mm"] = dict(limits)
        body["profiles"][0]["build_volume_limits_mm"] = {**limits, "alternative_footprints_inclusive_mm": []}
        self.assertEqual(material_parity_digest(body, generic, "PLA"), "b" * 64)
        self.assertEqual(v2_projection(body["profiles"][0]), generic)
        # Any other difference in the limits still breaks the binding.
        body["profiles"][0]["build_volume_limits_mm"]["source_profile"] = "other.ini"
        self.assertIsNone(material_parity_digest(body, generic, "PLA"))

    def test_invalid_material_variants_fail_closed(self):
        generic, body = self.fixture()
        for key, value in [("supports", False), ("supports", 1), ("effective_profile_sha256", "B" * 64), ("filament_density_g_cm3", 0), ("filament_density_g_cm3", True), ("filament_density_g_cm3", float("nan"))]:
            candidate = copy.deepcopy(body)
            candidate["profiles"][0]["material_profiles"]["profiles"][0][key] = value
            self.assertIsNone(material_parity_digest(candidate, generic, "PLA"))
        body["profiles"][0]["material_profiles"]["profiles"] *= 2
        self.assertIsNone(material_parity_digest(body, generic, "PLA"))


if __name__ == "__main__":
    unittest.main()
