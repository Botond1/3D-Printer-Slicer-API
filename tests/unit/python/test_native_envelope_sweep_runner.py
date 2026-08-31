from __future__ import annotations

import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = (
    ROOT / "tests" / "testing-scripts" / "slicing"
    / "native_envelope_sweep_runner.py"
)


def load_runner():
    spec = importlib.util.spec_from_file_location("native_envelope_sweep_runner", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    import sys
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


RUNNER = load_runner()


class NativeEnvelopeFixtureTests(unittest.TestCase):
    def test_ascii_cuboid_has_exact_dimensions_and_outward_nonzero_normals(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "fixture.stl"
            target.write_bytes(RUNNER.cuboid_ascii_stl((347.9, 317.9, 60), "fixture"))

            self.assertEqual(
                RUNNER.inspect_ascii_fixture(target),
                {"x": 347.9, "y": 317.9, "z": 60.0},
            )
            text = target.read_text(encoding="ascii")
            self.assertEqual(text.count("facet normal"), 12)
            self.assertNotIn("facet normal 0 0 0", text)

    def test_zero_or_inward_normal_fails_fixture_precondition(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "fixture.stl"
            payload = RUNNER.cuboid_ascii_stl((10, 20, 30), "fixture").decode("ascii")
            target.write_text(
                payload.replace("facet normal 0 0 -1", "facet normal 0 0 0", 1),
                encoding="ascii",
            )
            with self.assertRaisesRegex(ValueError, "zero normal"):
                RUNNER.inspect_ascii_fixture(target)

    def test_native_command_is_no_shell_bounded_and_fixture_addressed(self):
        self.assertEqual(
            RUNNER.parse_native_info_command(None),
            ("prusa-slicer", "--info", "{fixture}"),
        )
        configured = RUNNER.parse_native_info_command(
            '["docker","run","--rm","-v","{fixture_dir}:/fixtures:ro",'
            '"candidate","prusa-slicer","--info","/fixtures/{fixture_name}"]'
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "mesh.stl"
            expanded = RUNNER.expand_native_info_command(configured, fixture)
        self.assertNotIn("{fixture_dir}", "\0".join(expanded))
        self.assertNotIn("{fixture_name}", "\0".join(expanded))
        self.assertIn("/fixtures/mesh.stl", expanded)

        invalid_values = (
            '"prusa-slicer"',
            '["prusa-slicer","--info"]',
            '["prusa-slicer","--info","{unknown}"]',
            '["prusa-slicer","--info","bad\\nvalue","{fixture}"]',
        )
        for invalid in invalid_values:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    RUNNER.parse_native_info_command(invalid)

    @mock.patch.object(RUNNER.subprocess, "run")
    def test_native_info_requires_exit_zero_and_exact_reported_dimensions(self, run):
        run.return_value = subprocess.CompletedProcess(
            ["prusa-slicer"], 0,
            stdout="size_x = 10\nsize_y = 20\nsize_z = 30\n",
            stderr="",
        )
        with mock.patch.dict(
            os.environ,
            {"SLICE_SERVICE_API_KEY": "must-not-reach-native", "PATH": os.environ.get("PATH", "")},
            clear=False,
        ):
            result = RUNNER.run_native_info_precondition(
                RUNNER.DEFAULT_NATIVE_INFO_COMMAND,
                Path("fixture.stl"),
                {"x": 10.0, "y": 20.0, "z": 30.0},
            )
        self.assertTrue(result.success)
        self.assertFalse(run.call_args.kwargs.get("shell", False))
        child_environment = run.call_args.kwargs["env"]
        self.assertNotIn("SLICE_SERVICE_API_KEY", child_environment)
        self.assertNotIn("ADMIN_API_KEY", child_environment)
        self.assertEqual(child_environment["PYTHONNOUSERSITE"], "1")

        run.return_value = subprocess.CompletedProcess(
            ["prusa-slicer"], 0,
            stdout="size_x = 10\nsize_y = 20\nsize_z = 29\n",
            stderr="",
        )
        self.assertEqual(
            RUNNER.run_native_info_precondition(
                RUNNER.DEFAULT_NATIVE_INFO_COMMAND,
                Path("fixture.stl"),
                {"x": 10.0, "y": 20.0, "z": 30.0},
            ).observation,
            "native_info_dimensions_mismatch",
        )


class NativeEnvelopePlanTests(unittest.TestCase):
    @staticmethod
    def catalogue_body(phase):
        profiles = []
        expected = (
            tuple(
                profile for profile in RUNNER.PROFILE_SPECS
                if profile.printer == "H2D-QUOTE"
            )
            if phase == "native-measurement"
            else RUNNER.PROFILE_SPECS
        )
        for profile in expected:
            largest = (
                profile.declared_dimensions_mm
                if phase == "native-measurement"
                else profile.expected_largest_passing_mm
            )
            profiles.append({
                "engine": profile.engine,
                "printer": {"id": profile.printer},
                "layer_height_mm": 0.2,
                "material": "PLA" if profile.engine == "orca" else None,
                "build_volume_limits_mm": {
                    "minimum_dimensions_inclusive_mm": {"x": 0.1, "y": 0.1, "z": 0.1},
                    "declared_build_volume_dimensions_mm": dict(
                        profile.declared_dimensions_mm
                    ),
                    "largest_passing_dimensions_inclusive_mm": dict(largest),
                    "source_profile": profile.selector_fields["printerProfile"],
                    "declared_source_kind": "profile-explicit",
                },
            })
        return {"schema": "r3d-profile-catalogue-v2", "profiles": profiles}

    def test_final_phase_covers_four_selectors_xy_axes_and_all_z_layers(self):
        cases = RUNNER.build_sweep_cases("final-admission")
        self.assertEqual(len(cases), 20)
        self.assertEqual(
            {(case.profile.key, case.axis, case.layer_height) for case in cases},
            {
                (profile.key, axis, layer)
                for profile in RUNNER.PROFILE_SPECS
                for axis, layer in (
                    ("x", 0.2), ("y", 0.2),
                    ("z", 0.1), ("z", 0.2), ("z", 0.3),
                )
            },
        )
        self.assertTrue(all(
            case.expected_rejection_stage == "request_prevalidation"
            for case in cases
        ))
        self.assertTrue(all(
            round(case.fail_value_mm - case.pass_value_mm, 6) == 0.1
            for case in cases
        ))
        for profile in RUNNER.PROFILE_SPECS:
            z_cases = [
                case for case in cases
                if case.profile.key == profile.key and case.axis == "z"
            ]
            self.assertEqual(
                [(case.layer_height, case.pass_value_mm, case.fail_value_mm)
                 for case in z_cases],
                [(0.1, profile.expected_largest_passing_mm["z"], 250.0
                  if profile.printer == "P1S" else 325.0),
                 (0.2, profile.expected_largest_passing_mm["z"], 250.0
                  if profile.printer == "P1S" else 325.0),
                 (0.3, profile.expected_largest_passing_mm["z"], 250.0
                  if profile.printer == "P1S" else 325.0)],
            )

    def test_native_measurement_phase_reaches_h2d_expected_boundaries_only(self):
        cases = RUNNER.build_sweep_cases("native-measurement")
        self.assertEqual(len(cases), 10)
        self.assertEqual({case.profile.printer for case in cases}, {"H2D-QUOTE"})
        orca_xy = [
            case for case in cases
            if case.profile.engine == "orca" and case.axis in {"x", "y"}
        ]
        self.assertEqual(
            [(case.axis, case.pass_value_mm, case.fail_value_mm,
              case.expected_rejection_stage) for case in orca_xy],
            [
                ("x", 347.9, 348.0, "native_safety_net"),
                ("y", 317.9, 318.0, "native_safety_net"),
            ],
        )
        for engine in ("prusa", "orca"):
            z_cases = [
                case for case in cases
                if case.profile.engine == engine and case.axis == "z"
            ]
            self.assertEqual(
                [(case.layer_height, case.pass_value_mm, case.fail_value_mm,
                  case.expected_rejection_stage) for case in z_cases],
                [
                    (0.1, 325.0, 325.1, "request_prevalidation"),
                    (0.2, 325.0, 325.1, "request_prevalidation"),
                    (0.3, 324.9, 325.0, "native_safety_net"),
                ],
            )

    def test_exact_h2d_and_p1s_selectors_are_explicit(self):
        selectors = {
            profile.key: dict(profile.selector_fields)
            for profile in RUNNER.PROFILE_SPECS
        }
        self.assertEqual(selectors["prusa-h2d-quote"], {
            "printerProfile": "FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini",
        })
        self.assertEqual(selectors["orca-h2d-quote"], {
            "printerProfile": "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json",
            "processProfile": "FDM_0.2mm.json",
        })
        self.assertEqual(selectors["prusa-p1s"], {
            "printerProfile": "FDM_0.2mm.ini",
        })
        self.assertEqual(selectors["orca-p1s"], {
            "printerProfile": "Bambu_P1S_0.4_nozzle.json",
            "processProfile": "FDM_0.2mm.json",
        })

    def test_request_fields_switch_every_offered_layer_without_selector_drift(self):
        cases = RUNNER.build_sweep_cases("final-admission")
        for case in cases:
            fields = RUNNER.build_request_fields(case)
            self.assertEqual(fields["orientationMode"], "preserve")
            self.assertEqual(fields["infill"], "0")
            if case.profile.engine == "orca":
                self.assertEqual(
                    fields["processProfile"],
                    f"FDM_{RUNNER.format_number(case.layer_height)}mm.json",
                )
            elif case.profile.printer == "H2D-QUOTE":
                self.assertEqual(
                    fields["printerProfile"],
                    f"FDM_P1S_H2D_SIZE_QUOTING_"
                    f"{RUNNER.format_number(case.layer_height)}mm.ini",
                )

    def test_expected_source_profile_tracks_prusa_layer_but_not_orca_process(self):
        cases = RUNNER.build_sweep_cases("final-admission")
        for printer, prefix in (
            ("P1S", "FDM_"),
            ("H2D-QUOTE", "FDM_P1S_H2D_SIZE_QUOTING_"),
        ):
            for layer_height in (0.1, 0.3):
                case = next(
                    candidate for candidate in cases
                    if candidate.profile.engine == "prusa"
                    and candidate.profile.printer == printer
                    and candidate.axis == "z"
                    and candidate.layer_height == layer_height
                )
                self.assertEqual(
                    RUNNER.expected_source_profile(case),
                    f"{prefix}{RUNNER.format_number(layer_height)}mm.ini",
                )

        for case in cases:
            if case.profile.engine != "orca":
                continue
            self.assertEqual(
                RUNNER.expected_source_profile(case),
                case.profile.selector_fields["printerProfile"],
            )
            self.assertNotEqual(
                RUNNER.expected_source_profile(case),
                RUNNER.build_request_fields(case)["processProfile"],
            )

    def test_phase_completion_uses_only_profiles_selected_for_that_phase(self):
        for phase, expected_cases, expected_profiles in (
            ("native-measurement", 10, 2),
            ("final-admission", 20, 4),
        ):
            cases = RUNNER.build_sweep_cases(phase)
            profile_by_key = {case.profile.key: case.profile for case in cases}
            results = [SimpleNamespace(success=True) for _ in range(expected_cases)]
            corners = [
                SimpleNamespace(success=True, profile=profile)
                for profile in profile_by_key.values()
            ]
            with self.subTest(phase=phase):
                self.assertEqual(len(corners), expected_profiles)
                self.assertTrue(RUNNER.is_complete_run(
                    phase, True, True, results, corners,
                ))
                self.assertFalse(RUNNER.is_complete_run(
                    phase, True, True, results, corners[:-1],
                ))
                self.assertFalse(RUNNER.is_complete_run(
                    phase, True, False, results, corners,
                ))

    def test_phase_guard_binds_declared_measurement_a_and_published_final_b(self):
        for phase in ("native-measurement", "final-admission"):
            body = self.catalogue_body(phase)
            with self.subTest(phase=phase):
                self.assertTrue(RUNNER.validate_catalogue_phase(body, phase).success)

                mutation = self.catalogue_body(phase)
                mutation["profiles"][0]["build_volume_limits_mm"][
                    "largest_passing_dimensions_inclusive_mm"
                ]["x"] -= 0.1
                result = RUNNER.validate_catalogue_phase(mutation, phase)
                self.assertFalse(result.success)
                self.assertEqual(result.observation, "catalogue_phase_envelope_mismatch")


class NativeEnvelopeResponseTests(unittest.TestCase):
    DIMENSIONS = {"x": 253.9, "y": 60.0, "z": 60.0}

    @classmethod
    def transform(cls):
        return {
            "transform_schema": 2,
            "size_unit": "mm",
            "keep_proportions": True,
            "requested_size": {"x": None, "y": None, "z": None},
            "scale_percent": 100,
            "scale_factors": {"x": 1, "y": 1, "z": 1},
            "orientation_mode": "preserve",
            "orientation_outcome": "preserved",
            "automatic_orientation_applied": False,
            "automatic_rotation_deg": {"x": 0, "y": 0, "z": 0},
            "requested_rotation_deg": {"x": 0, "y": 0, "z": 0},
            "rotation_deg": {"x": 0, "y": 0, "z": 0},
            "automatic_rotation_matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "rotation_matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "original_dimensions_available": True,
            "original_dimensions_mm": dict(cls.DIMENSIONS),
            "oriented_dimensions_mm": dict(cls.DIMENSIONS),
            "final_dimensions_mm": dict(cls.DIMENSIONS),
        }

    @classmethod
    def build_limits(cls, maximum_x):
        return {
            "min": {"x": 1, "y": 1, "z": 1},
            "max": {"x": maximum_x, "y": 320, "z": 325},
            "source_profile": "profile.json",
        }

    def test_response_classifies_prevalidation_and_native_safety_net(self):
        success_body = {
            "success": True,
            "model_transform": self.transform(),
        }
        self.assertEqual(
            RUNNER.validate_http_point("pass", self.DIMENSIONS, 200, success_body),
            (True, True, None, None, "accepted_exact_dimensions"),
        )
        base_error = {
            "success": False,
            "errorCode": "MODEL_OUT_OF_PRINTER_BOUNDS",
            "model_dimensions_mm": dict(self.DIMENSIONS),
            "model_transform": self.transform(),
        }
        prevalidation = {
            **base_error,
            "error": "Model dimensions are outside selected printer limits. X too large.",
            "build_volume_limits_mm": self.build_limits(253.8),
        }
        native = {
            **base_error,
            "error": (
                "Model dimensions are outside selected printer limits. "
                "The native slicer could not place the model fully inside the print volume."
            ),
            "build_volume_limits_mm": self.build_limits(256),
        }
        self.assertEqual(
            RUNNER.validate_http_point("fail", self.DIMENSIONS, 422, prevalidation)[3],
            "request_prevalidation",
        )
        self.assertEqual(
            RUNNER.validate_http_point("fail", self.DIMENSIONS, 422, native)[3],
            "native_safety_net",
        )
        expected_ceiling = {"x": 256.0, "y": 320.0, "z": 325.0}
        self.assertTrue(RUNNER.validate_http_point(
            "fail",
            self.DIMENSIONS,
            422,
            native,
            expected_ceiling,
            "profile.json",
        )[0])
        wrong_candidate = {
            **native,
            "build_volume_limits_mm": self.build_limits(255.9),
        }
        self.assertFalse(RUNNER.validate_http_point(
            "fail",
            self.DIMENSIONS,
            422,
            wrong_candidate,
            expected_ceiling,
            "profile.json",
        )[0])

        incomplete = dict(native)
        incomplete["model_transform"] = {
            "transform_schema": 2,
            "final_dimensions_mm": dict(self.DIMENSIONS),
        }
        self.assertFalse(
            RUNNER.validate_http_point("fail", self.DIMENSIONS, 422, incomplete)[0]
        )

    def test_bracket_requires_two_reproductions_and_planned_rejection_stage(self):
        case = RUNNER.build_sweep_cases("native-measurement")[0]
        rows = (
            RUNNER.PointObservation(
                "pass", case.pass_value_mm, 1, 200, None, None,
                True, True, True, "accepted_exact_dimensions",
            ),
            RUNNER.PointObservation(
                "pass", case.pass_value_mm, 2, 200, None, None,
                True, True, True, "accepted_exact_dimensions",
            ),
            RUNNER.PointObservation(
                "fail", case.fail_value_mm, 1, 422,
                "MODEL_OUT_OF_PRINTER_BOUNDS", case.expected_rejection_stage,
                True, False, True, "controlled_first_failure",
            ),
            RUNNER.PointObservation(
                "fail", case.fail_value_mm, 2, 422,
                "MODEL_OUT_OF_PRINTER_BOUNDS", case.expected_rejection_stage,
                True, False, True, "controlled_first_failure",
            ),
        )
        self.assertTrue(RUNNER.evaluate_bracket(case, rows).success)

        wrong_stage = list(rows)
        mismatched_stage = (
            "request_prevalidation"
            if case.expected_rejection_stage == "native_safety_net"
            else "native_safety_net"
        )
        wrong_stage[-1] = RUNNER.PointObservation(
            "fail", case.fail_value_mm, 2, 422,
            "MODEL_OUT_OF_PRINTER_BOUNDS", mismatched_stage,
            True, False, True, "controlled_first_failure",
        )
        self.assertFalse(RUNNER.evaluate_bracket(case, wrong_stage).success)

    @mock.patch.object(RUNNER, "curl_multipart_slice")
    @mock.patch.object(RUNNER, "run_native_info_precondition")
    def test_http_upload_never_runs_when_native_precondition_fails(
        self, native_precondition, curl_slice,
    ):
        native_precondition.return_value = RUNNER.NativeInfoResult(
            False, "native_info_rejected_fixture",
        )
        case = RUNNER.build_sweep_cases("final-admission")[0]
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = RUNNER.run_point(
                "http://127.0.0.1:3000", "secret", RUNNER.DEFAULT_NATIVE_INFO_COMMAND,
                case, "pass", case.pass_value_mm, 1, Path(temporary_directory),
            )
        self.assertFalse(result.success)
        self.assertFalse(result.native_precondition_passed)
        curl_slice.assert_not_called()


class NativeEnvelopeReportTests(unittest.TestCase):
    def test_publishable_verdict_distinguishes_native_measurement_from_admission_replay(self):
        self.assertEqual(
            RUNNER.publishable_tuple_verdict("native-measurement", True),
            "AUTHORITATIVE_NATIVE_MEASUREMENT",
        )
        self.assertEqual(
            RUNNER.publishable_tuple_verdict("final-admission", True),
            "PUBLISHED_ADMISSION_VERIFIED",
        )
        for phase in ("native-measurement", "final-admission"):
            self.assertEqual(
                RUNNER.publishable_tuple_verdict(phase, False),
                "FAIL_CLOSED_UNESTABLISHED",
            )
        with self.assertRaises(ValueError):
            RUNNER.publishable_tuple_verdict("unknown", True)

    def test_report_redacts_target_command_credentials_and_paths(self):
        case = RUNNER.build_sweep_cases("final-admission")[0]
        observations = (
            RUNNER.PointObservation(
                "pass", case.pass_value_mm, 1, 200, None, None,
                True, True, True, "accepted_exact_dimensions",
            ),
        )
        bracket = RUNNER.BracketResult(
            case, observations, None, None, False, False, False,
            "bracket_not_established",
        )
        private_url = "https://private.customer.example.invalid:9443"
        with tempfile.TemporaryDirectory() as temporary_directory:
            report = Path(temporary_directory) / "report.md"
            RUNNER.write_report(
                private_url, 200, True, "configured", [bracket], [],
                report_path=report,
            )
            text = report.read_text(encoding="utf-8")
        self.assertNotIn(private_url, text)
        self.assertNotIn("private.customer.example.invalid", text)
        self.assertNotIn("secret", text)
        self.assertNotIn(temporary_directory, text)
        self.assertIn("Target class: **external-redacted**", text)
        self.assertIn("FAIL_CLOSED_UNESTABLISHED", text)


if __name__ == "__main__":
    unittest.main()
