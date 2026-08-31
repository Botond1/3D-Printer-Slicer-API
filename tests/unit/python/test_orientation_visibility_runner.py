"""Deterministic unit coverage for the owner-run J3 HTTP proof."""

from __future__ import annotations

import copy
import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = (
    REPOSITORY_ROOT
    / "tests"
    / "testing-scripts"
    / "slicing"
    / "orientation_visibility_test_runner.py"
)


def load_runner():
    spec = importlib.util.spec_from_file_location(
        "orientation_visibility_test_runner", RUNNER_PATH,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load orientation visibility runner.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


RUNNER = load_runner()
AUTO_MATRIX = [
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
    [1.0, 0.0, 0.0],
]
AUTO_ROTATION = {"x": -90.0, "y": -90.0, "z": 0.0}
ZERO_ROTATION = {"x": 0.0, "y": 0.0, "z": 0.0}
IDENTITY_MATRIX = [list(row) for row in RUNNER.IDENTITY_MATRIX]


def find_case(key: str):
    return next(case for case in RUNNER.build_cases() if case.key == key)


def matrix_to_euler(matrix: list[list[float]]) -> dict[str, float]:
    sin_y = max(-1.0, min(1.0, -matrix[2][0]))
    if abs(abs(sin_y) - 1.0) > 1e-8:
        y = RUNNER.math.asin(sin_y)
        x = RUNNER.math.atan2(matrix[2][1], matrix[2][2])
        z = RUNNER.math.atan2(matrix[1][0], matrix[0][0])
    elif sin_y > 0:
        y = RUNNER.math.pi / 2
        x = RUNNER.math.atan2(matrix[0][1], matrix[0][2])
        z = 0.0
    else:
        y = -RUNNER.math.pi / 2
        x = RUNNER.math.atan2(-matrix[0][1], -matrix[0][2])
        z = 0.0
    return {
        "x": round(RUNNER.math.degrees(x), 6),
        "y": round(RUNNER.math.degrees(y), 6),
        "z": round(RUNNER.math.degrees(z), 6),
    }


def transform_payload(case, dimensions: dict[str, float]) -> dict:
    if case.expected_mode == "preserve":
        automatic_matrix = copy.deepcopy(IDENTITY_MATRIX)
        automatic_rotation = dict(ZERO_ROTATION)
        outcome = "preserved"
        applied = False
    else:
        automatic_matrix = copy.deepcopy(AUTO_MATRIX)
        automatic_rotation = dict(AUTO_ROTATION)
        outcome = "applied"
        applied = True
    requested_rotation = {
        axis: case.requested_rotation_deg[index]
        for index, axis in enumerate(RUNNER.AXES)
    }
    requested_matrix = RUNNER.rotation_matrix_from_euler(requested_rotation)
    total_matrix = RUNNER.multiply_rotation_matrices(
        requested_matrix, automatic_matrix,
    )
    oriented = {
        axis: round(value, 6)
        for axis, value in RUNNER.replay_rotated_dimensions(
            dimensions, automatic_matrix,
        ).items()
    }
    final = {
        axis: round(value, 6)
        for axis, value in RUNNER.replay_rotated_dimensions(
            dimensions, total_matrix,
        ).items()
    }
    return {
        "transform_schema": 1,
        "size_unit": "mm",
        "keep_proportions": True,
        "requested_size": {"x": None, "y": None, "z": None},
        "scale_percent": 100,
        "scale_factors": {"x": 1.0, "y": 1.0, "z": 1.0},
        "orientation_mode": case.expected_mode,
        "orientation_outcome": outcome,
        "automatic_orientation_applied": applied,
        "automatic_rotation_deg": automatic_rotation,
        "requested_rotation_deg": requested_rotation,
        "rotation_deg": matrix_to_euler(total_matrix),
        "automatic_rotation_matrix": automatic_matrix,
        "rotation_matrix": total_matrix,
        "original_dimensions_mm": dict(dimensions),
        "oriented_dimensions_mm": oriented,
        "final_dimensions_mm": dict(final),
    }


def limits_payload(case) -> dict:
    source_profile = (
        f"Bambu_{case.printer}_0.4_nozzle.json"
        if case.engine == "orca"
        else "FDM_0.2mm.ini"
    )
    return {
        "min": dict(RUNNER.MINIMUM_LIMITS),
        "max": case.expected_limits,
        "source_profile": source_profile,
    }


def response_payload(case, dimensions: dict[str, float]) -> dict:
    transform = transform_payload(case, dimensions)
    if case.expected_status == 200:
        return {
            "success": True,
            "slicer_engine": case.engine,
            "model_transform": transform,
            "build_volume_limits_mm": limits_payload(case),
            "stats": {"object_height_mm": transform["final_dimensions_mm"]["z"]},
        }
    return {
        "success": False,
        "error": "Synthetic bounds response",
        "errorCode": "MODEL_OUT_OF_PRINTER_BOUNDS",
        "model_dimensions_mm": dict(transform["final_dimensions_mm"]),
        "model_transform": transform,
        "build_volume_limits_mm": limits_payload(case),
    }


class FixtureGenerationTests(unittest.TestCase):
    def test_primary_and_distinct_fixtures_are_remeasured_from_ascii_vertices(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            paths, measurements, observations = RUNNER.write_and_measure_fixtures(
                Path(temporary_directory)
            )

            self.assertEqual(
                measurements["j3_primary_20x255x255"],
                {"x": 20.0, "y": 255.0, "z": 255.0},
            )
            self.assertEqual(
                measurements["j3_distinct_20x240x245"],
                {"x": 20.0, "y": 240.0, "z": 245.0},
            )
            self.assertTrue(all(observation.success for observation in observations))
            self.assertTrue(all(path.parent == Path(temporary_directory) for path in paths.values()))
            primary_text = paths["j3_primary_20x255x255"].read_text(encoding="ascii")
            self.assertEqual(primary_text.count("vertex "), 36)

    def test_measurement_uses_file_coordinates_not_a_declared_fixture_size(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "actual.stl"
            fixture.write_bytes(RUNNER.cuboid_ascii_stl((21, 255, 255), "actual"))
            measured = RUNNER.measure_ascii_stl(fixture)

        self.assertEqual(measured, {"x": 21.0, "y": 255.0, "z": 255.0})
        self.assertFalse(RUNNER.dimensions_close(
            measured, {"x": 20.0, "y": 255.0, "z": 255.0},
        ))

    def test_measurement_rejects_non_ascii_and_incomplete_stl(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            non_ascii = Path(temporary_directory) / "non-ascii.stl"
            non_ascii.write_bytes(b"solid fixture\n\xff\nendsolid fixture\n")
            incomplete = Path(temporary_directory) / "incomplete.stl"
            incomplete.write_text(
                "solid fixture\nvertex 0 0 0\nendsolid fixture\n",
                encoding="ascii",
            )
            with self.assertRaisesRegex(ValueError, "readable ASCII STL"):
                RUNNER.measure_ascii_stl(non_ascii)
            with self.assertRaisesRegex(ValueError, "exactly 12 triangles"):
                RUNNER.measure_ascii_stl(incomplete)


class ApprovedMatrixTests(unittest.TestCase):
    def test_matrix_has_exact_unique_eighteen_case_contract(self):
        cases = RUNNER.build_cases()
        self.assertEqual(len(cases), 18)
        self.assertEqual(len({case.key for case in cases}), 18)
        self.assertTrue(all(case.expected_mode in {"auto", "preserve"} for case in cases))

    def test_p1s_primary_matrix_covers_default_auto_explicit_auto_and_preserve(self):
        for engine in ("prusa", "orca"):
            selected = [
                case for case in RUNNER.build_cases()
                if case.engine == engine
                and case.printer == "P1S"
                and case.fixture_key == "j3_primary_20x255x255"
            ]
            self.assertEqual(
                [(case.orientation_mode, case.expected_status) for case in selected],
                [(None, 200), ("auto", 200), ("preserve", 422)],
            )

    def test_h2d_rows_use_only_the_real_orca_profile_and_both_modes_succeed(self):
        selected = [case for case in RUNNER.build_cases() if case.printer == "H2D"]
        self.assertEqual(
            [(case.engine, case.orientation_mode, case.expected_status) for case in selected],
            [("orca", "auto", 200), ("orca", "preserve", 200)],
        )
        self.assertFalse(any(
            case.engine == "prusa" and case.printer == "H2D"
            for case in RUNNER.build_cases()
        ))

    def test_distinct_fixture_succeeds_in_both_modes_for_both_engines(self):
        selected = [
            case for case in RUNNER.build_cases()
            if case.fixture_key == "j3_distinct_20x240x245"
        ]
        self.assertEqual(len(selected), 4)
        self.assertTrue(all(case.expected_status == 200 for case in selected))
        self.assertEqual({case.engine for case in selected}, {"prusa", "orca"})
        self.assertEqual({case.expected_mode for case in selected}, {"auto", "preserve"})

    def test_j2_default_auto_regressions_exist_for_both_engines(self):
        for engine in ("prusa", "orca"):
            selected = [
                case for case in RUNNER.build_cases()
                if case.engine == engine and case.fixture_key.startswith("j2_")
            ]
            self.assertEqual(
                [(case.fixture_key, case.orientation_mode, case.expected_status) for case in selected],
                [
                    ("j2_z230_20x20x230", None, 200),
                    ("j2_z260_20x20x260", None, 422),
                    ("j2_x300_300x20x20", None, 422),
                ],
            )

    def test_request_fields_preserve_default_omission_and_exact_profiles(self):
        default_prusa = find_case("prusa-p1s-primary-default-auto")
        explicit_orca = find_case("orca-h2d-primary-preserve")
        prusa_fields = RUNNER.build_request_fields(default_prusa)
        orca_fields = RUNNER.build_request_fields(explicit_orca)

        self.assertNotIn("orientationMode", prusa_fields)
        self.assertEqual(prusa_fields["printerProfile"], "FDM_0.2mm.ini")
        self.assertEqual(orca_fields["orientationMode"], "preserve")
        self.assertEqual(orca_fields["printerProfile"], "Bambu_H2D_0.4_nozzle.json")
        self.assertEqual(orca_fields["processProfile"], "FDM_0.2mm.json")
        for fields in (prusa_fields, orca_fields):
            self.assertEqual(
                {axis: fields[f"rotation{axis.upper()}"] for axis in ("x", "y", "z")},
                {"x": "0", "y": "0", "z": "0"},
            )

        composed = RUNNER.build_request_fields(
            find_case("orca-p1s-distinct-auto-request-z90")
        )
        self.assertEqual(
            {axis: composed[f"rotation{axis.upper()}"] for axis in ("x", "y", "z")},
            {"x": "0", "y": "0", "z": "90"},
        )


class TransformContractTests(unittest.TestCase):
    PRIMARY_DIMENSIONS = {"x": 20.0, "y": 255.0, "z": 255.0}
    DISTINCT_DIMENSIONS = {"x": 20.0, "y": 240.0, "z": 245.0}

    def test_valid_auto_success_proves_k1_k3_and_height_invariant(self):
        case = find_case("orca-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)

        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body),
            (True, "k1_k3_success_and_height_invariant_valid"),
        )
        self.assertEqual(
            body["model_transform"]["final_dimensions_mm"],
            {"x": 255.0, "y": 255.0, "z": 20.0},
        )

    def test_valid_preserve_success_keeps_distinct_submitted_axes(self):
        case = find_case("prusa-p1s-distinct-preserve")
        body = response_payload(case, self.DISTINCT_DIMENSIONS)

        self.assertTrue(RUNNER.validate_case_response(
            case, self.DISTINCT_DIMENSIONS, 200, body,
        )[0])
        self.assertEqual(
            body["model_transform"]["final_dimensions_mm"],
            self.DISTINCT_DIMENSIONS,
        )

    def test_k1_schema_and_exact_transform_shape_fail_closed(self):
        case = find_case("orca-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["transform_schema"] = 2
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "k1_transform_schema_invalid",
        )

        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"].pop("transform_schema")
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "model_transform_shape_invalid",
        )

    def test_original_dimensions_cannot_be_post_orientation_dimensions(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["original_dimensions_mm"] = {
            "x": 255.0, "y": 255.0, "z": 20.0,
        }

        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "original_dimensions_not_submitted_dimensions",
        )

    def test_applied_flag_and_matrix_identity_must_agree(self):
        case = find_case("orca-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["automatic_orientation_applied"] = False
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "automatic_orientation_flag_invalid",
        )

        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["automatic_rotation_matrix"] = copy.deepcopy(IDENTITY_MATRIX)
        body["model_transform"]["rotation_matrix"] = copy.deepcopy(IDENTITY_MATRIX)
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "automatic_orientation_matrix_identity_invalid",
        )

    def test_k3_matrix_must_replay_reported_final_dimensions(self):
        case = find_case("orca-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["final_dimensions_mm"]["z"] = 21.0
        body["stats"]["object_height_mm"] = 21.0

        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "k3_rotation_matrix_not_replayable",
        )

    def test_k3_euler_values_must_describe_the_authoritative_matrix(self):
        case = find_case("orca-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["rotation_deg"] = dict(ZERO_ROTATION)

        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "total_euler_matrix_mismatch",
        )

    def test_object_height_must_equal_final_z(self):
        case = find_case("prusa-p1s-distinct-auto-request-z90")
        body = response_payload(case, self.DISTINCT_DIMENSIONS)
        body["stats"]["object_height_mm"] = 245.0

        self.assertEqual(
            RUNNER.validate_case_response(case, self.DISTINCT_DIMENSIONS, 200, body)[1],
            "success_or_object_height_contract_invalid",
        )

    def test_k3_composes_requested_z90_after_automatic_orientation(self):
        case = find_case("orca-p1s-distinct-auto-request-z90")
        body = response_payload(case, self.DISTINCT_DIMENSIONS)
        transform = body["model_transform"]

        self.assertTrue(RUNNER.validate_case_response(
            case, self.DISTINCT_DIMENSIONS, 200, body,
        )[0])
        self.assertEqual(transform["requested_rotation_deg"], {
            "x": 0.0, "y": 0.0, "z": 90.0,
        })
        self.assertNotEqual(
            transform["automatic_rotation_matrix"], transform["rotation_matrix"],
        )
        self.assertEqual(transform["oriented_dimensions_mm"], {
            "x": 240.0, "y": 245.0, "z": 20.0,
        })
        self.assertEqual(transform["final_dimensions_mm"], {
            "x": 245.0, "y": 240.0, "z": 20.0,
        })

        mutation = copy.deepcopy(body)
        mutation["model_transform"]["rotation_matrix"] = copy.deepcopy(
            mutation["model_transform"]["automatic_rotation_matrix"]
        )
        self.assertEqual(
            RUNNER.validate_case_response(
                case, self.DISTINCT_DIMENSIONS, 200, mutation,
            )[1],
            "k3_total_matrix_composition_invalid",
        )

    def test_k2_bounds_payload_requires_complete_transform_and_final_dimensions(self):
        case = find_case("prusa-p1s-primary-preserve-bounds")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 422, body),
            (True, "k1_k2_k3_bounds_contract_valid"),
        )
        self.assertEqual(body["model_transform"]["orientation_mode"], "preserve")
        self.assertEqual(body["model_transform"]["orientation_outcome"], "preserved")

        missing_transform = copy.deepcopy(body)
        missing_transform.pop("model_transform")
        self.assertEqual(
            RUNNER.validate_case_response(
                case, self.PRIMARY_DIMENSIONS, 422, missing_transform,
            )[1],
            "model_transform_shape_invalid",
        )

        wrong_dimensions = copy.deepcopy(body)
        wrong_dimensions["model_dimensions_mm"]["z"] = 20.0
        self.assertEqual(
            RUNNER.validate_case_response(
                case, self.PRIMARY_DIMENSIONS, 422, wrong_dimensions,
            )[1],
            "k2_bounds_payload_invalid",
        )

    def test_default_auto_bounds_payload_exposes_auto_outcome(self):
        case = find_case("orca-p1s-j2-z260-default-auto-rejected")
        dimensions = {"x": 20.0, "y": 20.0, "z": 260.0}
        body = response_payload(case, dimensions)

        self.assertTrue(RUNNER.validate_case_response(case, dimensions, 422, body)[0])
        self.assertEqual(body["model_transform"]["orientation_mode"], "auto")
        self.assertEqual(body["model_transform"]["orientation_outcome"], "applied")

    def test_h2d_limits_are_distinct_from_p1s_limits(self):
        case = find_case("orca-h2d-primary-preserve")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        self.assertTrue(RUNNER.validate_case_response(
            case, self.PRIMARY_DIMENSIONS, 200, body,
        )[0])
        body["build_volume_limits_mm"]["max"] = dict(RUNNER.P1S_LIMITS)
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "build_volume_limits_invalid",
        )


class RequestAndPrivacyTests(unittest.TestCase):
    PRIMARY_DIMENSIONS = {"x": 20.0, "y": 255.0, "z": 255.0}

    def test_run_case_uses_common_multipart_helper_without_exposing_credential(self):
        case = find_case("orca-h2d-primary-preserve")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "fixture.stl"
            fixture.write_bytes(RUNNER.cuboid_ascii_stl((20, 255, 255), "fixture"))
            with mock.patch.object(
                RUNNER, "curl_multipart_slice", return_value=(200, body, 1.25),
            ) as request:
                result = RUNNER.run_case(
                    "https://owner-target.invalid",
                    "unit-only-secret",
                    case,
                    fixture,
                    self.PRIMARY_DIMENSIONS,
                )

        self.assertTrue(result.success)
        self.assertEqual(result.duration_sec, 1.25)
        kwargs = request.call_args.kwargs
        self.assertEqual(kwargs["slice_service_api_key"], "unit-only-secret")
        self.assertEqual(kwargs["extra_fields"]["orientationMode"], "preserve")
        self.assertEqual(kwargs["extra_fields"]["printerProfile"], "Bambu_H2D_0.4_nozzle.json")

    def test_429_retry_is_bounded_and_uses_no_raw_response_in_result(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
        success_body = response_payload(case, self.PRIMARY_DIMENSIONS)
        responses = [
            (429, {"errorCode": "RATE_LIMIT_EXCEEDED", "retryAfterSeconds": 1}, 0.1),
            (200, success_body, 0.2),
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "fixture.stl"
            fixture.write_bytes(RUNNER.cuboid_ascii_stl((20, 255, 255), "fixture"))
            with (
                mock.patch.object(RUNNER, "curl_multipart_slice", side_effect=responses) as request,
                mock.patch.object(RUNNER.time, "sleep") as sleep,
                redirect_stdout(io.StringIO()),
            ):
                result = RUNNER.run_case(
                    "https://owner-target.invalid",
                    "unit-only-secret",
                    case,
                    fixture,
                    self.PRIMARY_DIMENSIONS,
                )

        self.assertTrue(result.success)
        self.assertAlmostEqual(result.duration_sec, 0.3)
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertFalse(hasattr(result, "raw_body"))

    def test_report_redacts_external_host_ip_credentials_and_temporary_paths(self):
        sensitive_url = "https://203.0.113.77:443"
        fixture = RUNNER.FixtureObservation(
            key="synthetic",
            expected_dimensions_mm={"x": 20.0, "y": 255.0, "z": 255.0},
            measured_dimensions_mm={"x": 20.0, "y": 255.0, "z": 255.0},
            success=True,
        )
        result = RUNNER.CaseResult(
            key="synthetic-case",
            endpoint="/orca/slice",
            printer="P1S",
            requested_mode="auto",
            requested_rotation_deg=(0.0, 0.0, 0.0),
            fixture_key="synthetic",
            expected_status=200,
            http_status=200,
            error_code=None,
            success=True,
            duration_sec=1.0,
            observation="k1_k3_success_and_height_invariant_valid",
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            original_results_dir = RUNNER.RESULTS_DIR
            original_report_path = RUNNER.REPORT_PATH
            try:
                RUNNER.RESULTS_DIR = Path(temporary_directory)
                RUNNER.REPORT_PATH = Path(temporary_directory) / "report.md"
                RUNNER.write_report(sensitive_url, 200, True, [fixture], [result])
                report = RUNNER.REPORT_PATH.read_text(encoding="utf-8")
            finally:
                RUNNER.RESULTS_DIR = original_results_dir
                RUNNER.REPORT_PATH = original_report_path

        self.assertIn("Target class: **external-redacted**", report)
        self.assertNotIn(sensitive_url, report)
        self.assertNotIn("203.0.113.77", report)
        self.assertNotIn("unit-only-secret", report)
        self.assertNotIn(temporary_directory, report)

    def test_missing_slice_key_stops_before_health_or_report(self):
        with (
            mock.patch.object(RUNNER, "resolve_base_url", return_value="https://target.invalid"),
            mock.patch.object(RUNNER, "resolve_slice_service_api_key", return_value=None),
            mock.patch.object(RUNNER, "curl_json") as health,
            mock.patch.object(RUNNER, "write_report") as write_report,
            redirect_stdout(io.StringIO()) as output,
        ):
            exit_code = RUNNER.main()

        self.assertEqual(exit_code, 1)
        health.assert_not_called()
        write_report.assert_not_called()
        self.assertNotIn("target.invalid", output.getvalue())


if __name__ == "__main__":
    unittest.main()
