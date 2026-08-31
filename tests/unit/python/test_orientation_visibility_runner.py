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
QUOTE_LIMITS = {
    "prusa": {"x": 349.8, "y": 319.8, "z": 324.8},
    "orca": {"x": 347.8, "y": 317.8, "z": 324.8},
}


def find_case(key: str):
    return next(case for case in RUNNER.build_cases() if case.key == key)


def expected_limits(case) -> dict[str, float]:
    return case.fixed_expected_limits or dict(QUOTE_LIMITS[case.engine])


def accepted_native_probe(file_path: Path):
    dimensions = RUNNER.measure_ascii_stl(file_path)
    return RUNNER.NativeInfoObservation(
        accepted=True,
        dimensions_mm=dimensions,
        exit_code=0,
        observation="native_info_accepted",
    )


def fixture_native_probe(file_path: Path):
    if file_path.stem == "j3b_zero_normal_60x60x240":
        return RUNNER.NativeInfoObservation(
            accepted=False,
            dimensions_mm=None,
            exit_code=1,
            observation="native_info_rejected",
        )
    return accepted_native_probe(file_path)


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
        "transform_schema": 2,
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
        "original_dimensions_available": case.expected_original_dimensions_available,
        "original_dimensions_mm": (
            dict(dimensions) if case.expected_original_dimensions_available else None
        ),
        "oriented_dimensions_mm": oriented,
        "final_dimensions_mm": dict(final),
    }


def limits_payload(case) -> dict:
    source_profile = RUNNER.PROFILE_SELECTORS[(case.engine, case.printer)]["printerProfile"]
    return {
        "min": dict(RUNNER.MINIMUM_LIMITS),
        "max": expected_limits(case),
        "source_profile": source_profile,
    }


def response_payload(case, dimensions: dict[str, float]) -> dict:
    if case.expected_error_code == "INVALID_ORIENTATION_MODE":
        return {
            "success": False,
            "error": "Invalid orientationMode. Allowed values: auto, preserve.",
            "errorCode": "INVALID_ORIENTATION_MODE",
        }
    if case.expected_error_code == "MODEL_DIMENSIONS_UNAVAILABLE":
        return {
            "success": False,
            "error": "Synthetic oriented dimensions unavailable response",
            "errorCode": "MODEL_DIMENSIONS_UNAVAILABLE",
        }
    transform = transform_payload(case, dimensions)
    if case.expected_status == 200:
        return {
            "success": True,
            "slicer_engine": case.engine,
            "model_transform": transform,
            "build_volume_limits_mm": limits_payload(case),
            "stats": {
                "object_height_mm": transform["final_dimensions_mm"]["z"],
                **(
                    {"material_used_g": case.expected_material_used_g}
                    if case.expected_material_used_g is not None else {}
                ),
            },
        }
    return {
        "success": False,
        "error": "Synthetic bounds response",
        "errorCode": "MODEL_OUT_OF_PRINTER_BOUNDS",
        "model_dimensions_mm": dict(transform["final_dimensions_mm"]),
        "model_transform": transform,
        "build_volume_limits_mm": limits_payload(case),
    }


def catalogue_body() -> dict:
    profiles = []
    for (engine, printer), selector in RUNNER.PROFILE_SELECTORS.items():
        largest = (
            RUNNER.P1S_LIMITS_BY_ENGINE[engine]
            if printer == "P1S"
            else QUOTE_LIMITS[engine]
        )
        profiles.append({
            "engine": engine,
            "printer": {"id": printer, "name": printer},
            "layer_height_mm": RUNNER.LAYER_HEIGHT,
            "material": "PLA" if engine == "orca" else None,
            "slice_selector": {
                "endpoint": f"/{engine}/slice",
                "parameters": [
                    {"name": name, "value": value}
                    for name, value in selector.items()
                ],
            },
            "build_volume_limits_mm": {
                "minimum_dimensions_inclusive_mm": dict(RUNNER.MINIMUM_LIMITS),
                "declared_build_volume_dimensions_mm": dict(
                    RUNNER.DECLARED_LIMITS_BY_PRINTER[printer]
                ),
                "largest_passing_dimensions_inclusive_mm": dict(largest),
                "source_profile": selector["printerProfile"],
                "declared_source_kind": "profile-explicit",
            },
        })
    return {"schema": RUNNER.CATALOGUE_SCHEMA, "profiles": profiles}


class FixtureGenerationTests(unittest.TestCase):
    def test_primary_and_distinct_fixtures_are_remeasured_from_ascii_vertices(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            paths, measurements, observations = RUNNER.write_and_measure_fixtures(
                Path(temporary_directory),
                native_info_probe=fixture_native_probe,
            )

            self.assertEqual(
                measurements["j3_primary_20x255x255"],
                {"x": 20.0, "y": 255.0, "z": 255.0},
            )
            self.assertEqual(
                measurements["j3_distinct_20x240x245"],
                {"x": 20.0, "y": 240.0, "z": 245.0},
            )
            self.assertEqual(
                measurements["j3_all_axes_distinct_18x130x240"],
                {"x": 18.0, "y": 130.0, "z": 240.0},
            )
            self.assertTrue(all(observation.success for observation in observations))
            self.assertTrue(all(path.parent == Path(temporary_directory) for path in paths.values()))
            primary_text = paths["j3_primary_20x255x255"].read_text(encoding="ascii")
            self.assertEqual(primary_text.count("vertex "), 36)
            self.assertNotIn("facet normal 0 0 0", primary_text)
            self.assertTrue(RUNNER.validate_ascii_outward_normals(
                paths["j3_primary_20x255x255"],
            ))
            zero_payload = paths["j3b_zero_normal_60x60x240"].read_bytes()
            self.assertEqual(len(zero_payload), 84 + 12 * 50)
            self.assertFalse(zero_payload.startswith(b"solid"))
            self.assertTrue(RUNNER.validate_binary_zero_normals(
                paths["j3b_zero_normal_60x60x240"],
            ))
            zero_observation = next(
                item for item in observations
                if item.key == "j3b_zero_normal_60x60x240"
            )
            self.assertEqual(zero_observation.native_info_expectation, "deliberate-rejection")

    def test_measurement_uses_file_coordinates_not_a_declared_fixture_size(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "actual.stl"
            fixture.write_bytes(RUNNER.cuboid_ascii_stl((21, 255, 255), "actual"))
            measured = RUNNER.measure_ascii_stl(fixture)

        self.assertEqual(measured, {"x": 21.0, "y": 255.0, "z": 255.0})
        self.assertFalse(RUNNER.dimensions_close(
            measured, {"x": 20.0, "y": 255.0, "z": 255.0},
        ))

    def test_outward_normal_check_rejects_a_reversed_stored_normal(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "reversed-normal.stl"
            payload = RUNNER.cuboid_ascii_stl((20, 30, 40), "reversed_normal")
            fixture.write_bytes(payload.replace(
                b"facet normal 0 0 -1",
                b"facet normal 0 0 1",
                1,
            ))

            self.assertFalse(RUNNER.validate_ascii_outward_normals(fixture))

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
            with self.assertRaisesRegex(ValueError, "malformed STL vertex"):
                RUNNER.measure_ascii_stl(incomplete)

    def test_native_info_probe_uses_exact_argv_and_parses_positive_dimensions(self):
        completed = mock.Mock(
            returncode=0,
            stdout="size_x = 20\nsize_y = 240\nsize_z = 245\n",
        )
        command_runner = mock.Mock(return_value=completed)
        fixture_path = Path("synthetic-fixture.stl")

        observation = RUNNER.probe_native_model_info(
            fixture_path,
            command_runner=command_runner,
        )

        self.assertTrue(observation.accepted)
        self.assertEqual(
            observation.dimensions_mm,
            {"x": 20.0, "y": 240.0, "z": 245.0},
        )
        args, kwargs = command_runner.call_args
        self.assertEqual(args[0], ["prusa-slicer", "--info", str(fixture_path)])
        self.assertFalse(kwargs["shell"])
        self.assertEqual(kwargs["timeout"], RUNNER.NATIVE_INFO_TIMEOUT_SECONDS)
        self.assertNotIn("SLICE_SERVICE_API_KEY", kwargs["env"])

    def test_configured_native_info_command_is_bounded_no_shell_and_secret_free(self):
        configured = RUNNER.parse_native_info_command(
            '["docker","exec","candidate","prusa-slicer","--info","{fixture}"]'
        )
        completed = mock.Mock(
            returncode=0,
            stdout="size_x = 20\nsize_y = 240\nsize_z = 245\n",
        )
        command_runner = mock.Mock(return_value=completed)
        fixture_path = Path("synthetic-fixture.stl")

        with mock.patch.dict(
            RUNNER.os.environ,
            {
                "PATH": RUNNER.os.environ.get("PATH", ""),
                "SLICE_SERVICE_API_KEY": "must-not-reach-native",
                "ADMIN_API_KEY": "must-not-reach-native",
            },
            clear=False,
        ):
            observation = RUNNER.probe_native_model_info(
                fixture_path,
                command_runner=command_runner,
                command_template=configured,
            )

        self.assertTrue(observation.accepted)
        args, kwargs = command_runner.call_args
        self.assertEqual(
            args[0],
            [
                "docker", "exec", "candidate", "prusa-slicer", "--info",
                str(fixture_path),
            ],
        )
        self.assertFalse(kwargs["shell"])
        self.assertNotIn("SLICE_SERVICE_API_KEY", kwargs["env"])
        self.assertNotIn("ADMIN_API_KEY", kwargs["env"])

    def test_native_info_command_rejects_invalid_or_unaddressed_templates(self):
        for value in (
            '"prusa-slicer"',
            '["prusa-slicer","--info"]',
            '["prusa-slicer","--info","{unknown}"]',
            '["prusa-slicer","--info","bad\\nvalue","{fixture}"]',
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    RUNNER.parse_native_info_command(value)

    def test_native_info_environment_mirrors_production_safe_contract(self):
        environment = RUNNER._native_info_environment()
        self.assertEqual(environment["PYTHONDONTWRITEBYTECODE"], "1")
        self.assertEqual(environment["PYTHONNOUSERSITE"], "1")
        self.assertEqual(environment["PYTHONUNBUFFERED"], "1")
        self.assertEqual(environment["PYTHONUTF8"], "1")
        if RUNNER.sys.platform != "win32":
            self.assertEqual(environment["TMPDIR"], "/tmp")
            self.assertEqual(environment["TEMP"], "/tmp")
            self.assertEqual(environment["TMP"], "/tmp")
            self.assertEqual(environment["HOME"], "/tmp/slicer-home")
            self.assertEqual(environment["XDG_CACHE_HOME"], "/tmp/xdg-cache")
            self.assertEqual(environment["XDG_CONFIG_HOME"], "/tmp/xdg-config")
            self.assertEqual(environment["XDG_RUNTIME_DIR"], "/tmp/xdg-runtime")

    def test_native_precondition_rejects_axis_drift_as_not_evaluable(self):
        wrong_dimensions = RUNNER.NativeInfoObservation(
            True,
            {"x": 21.0, "y": 240.0, "z": 245.0},
            0,
            "native_info_accepted",
        )
        result = RUNNER.normal_fixture_precondition(
            Path("synthetic.stl"),
            {"x": 20.0, "y": 240.0, "z": 245.0},
            native_info_probe=lambda _: wrong_dimensions,
        )
        self.assertEqual(
            result,
            (False, "fixture_native_dimensions_precondition_failed_service_not_evaluated"),
        )


class ApprovedMatrixTests(unittest.TestCase):
    def test_matrix_has_exact_unique_thirty_seven_case_contract(self):
        cases = RUNNER.build_cases()
        self.assertEqual(len(cases), 37)
        self.assertEqual(len({case.key for case in cases}), 37)
        self.assertTrue(all(
            case.expected_mode in {"auto", "preserve", "sideways"}
            for case in cases
        ))

    def test_p1s_primary_matrix_covers_default_auto_explicit_auto_and_preserve(self):
        for engine in ("prusa", "orca"):
            selected = [
                case for case in RUNNER.build_cases()
                if case.engine == engine
                and case.printer == "P1S"
                and case.fixture_key == "j3_primary_20x255x255"
            ]
            expected_auto = 200 if engine == "prusa" else 422
            self.assertEqual(
                [(case.orientation_mode, case.expected_status) for case in selected],
                [(None, expected_auto), ("auto", expected_auto), ("preserve", 422)],
            )

    def test_h2d_quote_rows_cover_both_real_selectors_and_both_modes(self):
        selected = [case for case in RUNNER.build_cases() if case.printer == "H2D-QUOTE"]
        self.assertEqual(
            [(case.engine, case.orientation_mode, case.expected_status) for case in selected],
            [
                ("prusa", "auto", 200),
                ("prusa", "preserve", 200),
                ("orca", "auto", 200),
                ("orca", "preserve", 200),
            ],
        )

    def test_distinct_fixture_succeeds_in_both_modes_for_both_engines(self):
        selected = [
            case for case in RUNNER.build_cases()
            if case.fixture_key == "j3_distinct_20x240x245"
        ]
        self.assertEqual(len(selected), 6)
        self.assertTrue(all(case.expected_status == 200 for case in selected))
        self.assertEqual({case.engine for case in selected}, {"prusa", "orca"})
        self.assertEqual({case.expected_mode for case in selected}, {"auto", "preserve"})
        for engine in ("prusa", "orca"):
            zero_request = find_case(
                f"{engine}-p1s-distinct-auto-zero-request-transform"
            )
            self.assertEqual(zero_request.requested_rotation_deg, (0.0, 0.0, 0.0))

    def test_section_zero_all_axes_distinct_and_invalid_mode_rows_are_exact(self):
        laid_flat = (
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            (1.0, 0.0, 0.0),
        )
        requested_x90 = (
            (1.0, 0.0, 0.0),
            (0.0, 0.0, -1.0),
            (0.0, 1.0, 0.0),
        )
        for engine in ("prusa", "orca"):
            auto = find_case(f"{engine}-p1s-all-axes-distinct-auto-replay")
            self.assertEqual(auto.expected_oriented_dimensions_mm, (130.0, 240.0, 18.0))
            self.assertEqual(auto.expected_final_dimensions_mm, (130.0, 240.0, 18.0))
            self.assertEqual(auto.expected_automatic_rotation_matrix, laid_flat)
            self.assertEqual(auto.expected_rotation_matrix, laid_flat)

            requested = find_case(
                f"{engine}-p1s-all-axes-distinct-preserve-request-x90"
            )
            self.assertEqual(requested.requested_rotation_deg, (90.0, 0.0, 0.0))
            self.assertEqual(requested.expected_final_dimensions_mm, (18.0, 240.0, 130.0))
            self.assertEqual(requested.expected_rotation_matrix, requested_x90)

            invalid = find_case(f"{engine}-p1s-invalid-orientation-mode")
            self.assertEqual(invalid.orientation_mode, "sideways")
            self.assertEqual(invalid.expected_status, 400)
            self.assertEqual(invalid.expected_error_code, "INVALID_ORIENTATION_MODE")

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

    def test_native_boundary_and_zero_normal_regressions_are_explicit(self):
        cases = RUNNER.build_cases()
        boundary = [case for case in cases if case.fixture_key.startswith("j3b_orca_")]
        self.assertEqual(
            [(case.fixture_key, case.expected_status) for case in boundary],
            [
                ("j3b_orca_253x253x20", 200),
                ("j3b_orca_254x254x20", 422),
                ("j3b_orca_254x100x20", 422),
                ("j3b_orca_100x254x20", 422),
            ],
        )
        self.assertEqual(
            find_case("prusa-p1s-256x256-preserve-accepted").expected_status,
            200,
        )
        zero = [case for case in cases if case.fixture_key == "j3b_zero_normal_60x60x240"]
        self.assertEqual(len(zero), 4)
        for engine in ("prusa", "orca"):
            auto = find_case(f"{engine}-zero-normal-explicit-auto-degraded-original")
            preserve = find_case(f"{engine}-zero-normal-preserve-degraded-original")
            self.assertEqual(auto.expected_status, 200)
            self.assertFalse(auto.expected_original_dimensions_available)
            self.assertEqual(preserve.expected_status, 200)
            self.assertFalse(preserve.expected_original_dimensions_available)
        mass_case = find_case("orca-p1s-253x253-preserve-accepted")
        self.assertEqual(mass_case.layer_height, 0.3)
        self.assertEqual(mass_case.expected_material_used_g, 456.33)

    def test_request_fields_preserve_default_omission_and_exact_profiles(self):
        default_prusa = find_case("prusa-p1s-primary-default-auto")
        explicit_orca = find_case("orca-h2d-quote-primary-preserve")
        explicit_prusa = find_case("prusa-h2d-quote-primary-preserve")
        prusa_fields = RUNNER.build_request_fields(default_prusa)
        orca_fields = RUNNER.build_request_fields(explicit_orca)
        quote_prusa_fields = RUNNER.build_request_fields(explicit_prusa)

        self.assertNotIn("orientationMode", prusa_fields)
        self.assertEqual(prusa_fields["printerProfile"], "FDM_0.2mm.ini")
        self.assertEqual(orca_fields["orientationMode"], "preserve")
        self.assertEqual(
            orca_fields["printerProfile"],
            "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json",
        )
        self.assertEqual(orca_fields["processProfile"], "FDM_0.2mm.json")
        self.assertEqual(
            quote_prusa_fields["printerProfile"],
            "FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini",
        )
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


class CatalogueV2PreflightTests(unittest.TestCase):
    def test_catalogue_v2_resolves_named_inclusive_limits_for_all_selectors(self):
        resolved, observations = RUNNER.validate_catalogue_v2(catalogue_body())

        self.assertEqual(set(resolved), set(RUNNER.PROFILE_SELECTORS))
        self.assertTrue(all(observation.success for observation in observations))
        self.assertEqual(
            resolved[("prusa", "P1S")],
            RUNNER.P1S_LIMITS_BY_ENGINE["prusa"],
        )
        self.assertEqual(resolved[("orca", "H2D-QUOTE")], QUOTE_LIMITS["orca"])

    def test_catalogue_v2_rejects_legacy_max_or_missing_inclusive_field(self):
        body = catalogue_body()
        limits = body["profiles"][0]["build_volume_limits_mm"]
        largest = limits.pop("largest_passing_dimensions_inclusive_mm")
        limits["max"] = largest

        resolved, observations = RUNNER.validate_catalogue_v2(body)

        self.assertNotIn(("prusa", "P1S"), resolved)
        self.assertIn(
            "catalogue_named_envelope_shape_invalid",
            {observation.observation for observation in observations},
        )

    def test_catalogue_v2_malformed_selector_fails_closed_without_exception(self):
        body = catalogue_body()
        body["profiles"][0]["slice_selector"] = None

        resolved, observations = RUNNER.validate_catalogue_v2(body)

        self.assertNotIn(("prusa", "P1S"), resolved)
        self.assertIn(
            "catalogue_selector_not_unique",
            {observation.observation for observation in observations},
        )

    def test_quote_limit_is_catalogue_resolved_not_a_runner_hardcode(self):
        body = catalogue_body()
        quote_profile = next(
            profile for profile in body["profiles"]
            if profile["engine"] == "prusa" and profile["printer"]["id"] == "H2D-QUOTE"
        )
        quote_profile["build_volume_limits_mm"][
            "largest_passing_dimensions_inclusive_mm"
        ] = {"x": 349.7, "y": 319.7, "z": 324.7}

        resolved, observations = RUNNER.validate_catalogue_v2(body)

        self.assertTrue(all(observation.success for observation in observations))
        self.assertEqual(
            resolved[("prusa", "H2D-QUOTE")],
            {"x": 349.7, "y": 319.7, "z": 324.7},
        )


class TransformContractTests(unittest.TestCase):
    PRIMARY_DIMENSIONS = {"x": 20.0, "y": 255.0, "z": 255.0}
    DISTINCT_DIMENSIONS = {"x": 20.0, "y": 240.0, "z": 245.0}
    ALL_AXES_DISTINCT_DIMENSIONS = {"x": 18.0, "y": 130.0, "z": 240.0}

    def test_valid_auto_success_proves_schema2_k3_and_height_invariant(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)

        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body),
            (True, "schema2_k3_success_and_height_invariant_valid"),
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

    def test_all_axes_distinct_auto_and_requested_x90_match_owner_proof(self):
        auto = find_case("prusa-p1s-all-axes-distinct-auto-replay")
        auto_body = response_payload(auto, self.ALL_AXES_DISTINCT_DIMENSIONS)
        self.assertTrue(RUNNER.validate_case_response(
            auto, self.ALL_AXES_DISTINCT_DIMENSIONS, 200, auto_body,
        )[0])
        self.assertEqual(
            auto_body["model_transform"]["oriented_dimensions_mm"],
            {"x": 130.0, "y": 240.0, "z": 18.0},
        )

        requested = find_case(
            "orca-p1s-all-axes-distinct-preserve-request-x90"
        )
        requested_body = response_payload(
            requested, self.ALL_AXES_DISTINCT_DIMENSIONS,
        )
        self.assertTrue(RUNNER.validate_case_response(
            requested,
            self.ALL_AXES_DISTINCT_DIMENSIONS,
            200,
            requested_body,
        )[0])
        self.assertEqual(
            requested_body["model_transform"]["final_dimensions_mm"],
            {"x": 18.0, "y": 240.0, "z": 130.0},
        )
        self.assertTrue(RUNNER._matrices_close(
            requested_body["model_transform"]["rotation_matrix"],
            [
                [1.0, 0.0, 0.0],
                [0.0, 0.0, -1.0],
                [0.0, 1.0, 0.0],
            ],
        ))

    def test_section_zero_exact_expectations_and_invalid_mode_fail_closed(self):
        auto = find_case("prusa-p1s-all-axes-distinct-auto-replay")
        mutation = response_payload(auto, self.ALL_AXES_DISTINCT_DIMENSIONS)
        mutation["model_transform"]["oriented_dimensions_mm"] = {
            "x": 240.0, "y": 130.0, "z": 18.0,
        }
        self.assertFalse(RUNNER.validate_case_response(
            auto, self.ALL_AXES_DISTINCT_DIMENSIONS, 200, mutation,
        )[0])

        invalid = find_case("orca-p1s-invalid-orientation-mode")
        invalid_body = response_payload(invalid, self.ALL_AXES_DISTINCT_DIMENSIONS)
        self.assertEqual(
            RUNNER.validate_case_response(
                invalid, self.ALL_AXES_DISTINCT_DIMENSIONS, 400, invalid_body,
            ),
            (True, "invalid_orientation_mode_bare_400_valid"),
        )
        invalid_body["model_transform"] = {}
        self.assertEqual(
            RUNNER.validate_case_response(
                invalid, self.ALL_AXES_DISTINCT_DIMENSIONS, 400, invalid_body,
            )[1],
            "invalid_orientation_mode_payload_invalid",
        )

    def test_schema2_and_exact_transform_shape_fail_closed(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["transform_schema"] = 1
        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "transform_schema_v2_invalid",
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

    def test_original_dimensions_schema2_availability_and_nullable_invariant(self):
        case = find_case("prusa-zero-normal-explicit-auto-degraded-original")
        body = response_payload(case, {"x": 60.0, "y": 60.0, "z": 240.0})
        self.assertTrue(RUNNER.validate_case_response(
            case,
            {"x": 60.0, "y": 60.0, "z": 240.0},
            200,
            body,
        )[0])

        mutation = copy.deepcopy(body)
        mutation["model_transform"]["original_dimensions_mm"] = {
            "x": 60.0, "y": 60.0, "z": 240.0,
        }
        self.assertEqual(
            RUNNER.validate_case_response(
                case,
                {"x": 60.0, "y": 60.0, "z": 240.0},
                200,
                mutation,
            )[1],
            "unavailable_original_dimensions_not_null",
        )

    def test_available_measured_zero_is_an_object_not_unavailable(self):
        transform = {
            "original_dimensions_available": True,
            "original_dimensions_mm": {"x": 0.0, "y": 2.0, "z": 3.0},
        }
        self.assertEqual(
            RUNNER.validate_original_dimensions_contract(
                transform,
                True,
                {"x": 0.0, "y": 2.0, "z": 3.0},
            ),
            (True, "original_dimensions_measured"),
        )

    def test_applied_flag_and_matrix_identity_must_agree(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
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
        case = find_case("prusa-p1s-primary-explicit-auto")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        body["model_transform"]["final_dimensions_mm"]["z"] = 21.0
        body["stats"]["object_height_mm"] = 21.0

        self.assertEqual(
            RUNNER.validate_case_response(case, self.PRIMARY_DIMENSIONS, 200, body)[1],
            "k3_rotation_matrix_not_replayable",
        )

    def test_k3_euler_values_must_describe_the_authoritative_matrix(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
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
            (True, "schema2_full_k2_k3_bounds_contract_valid"),
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

    def test_orca_253_mass_regression_remains_exact(self):
        case = find_case("orca-p1s-253x253-preserve-accepted")
        dimensions = {"x": 253.0, "y": 253.0, "z": 20.0}
        body = response_payload(case, dimensions)
        self.assertTrue(RUNNER.validate_case_response(case, dimensions, 200, body)[0])
        body["stats"]["material_used_g"] = 456.50
        self.assertEqual(
            RUNNER.validate_case_response(case, dimensions, 200, body)[1],
            "expected_material_mass_regressed",
        )

    def test_h2d_quote_limits_are_catalogue_resolved_and_distinct_from_p1s(self):
        case = find_case("orca-h2d-quote-primary-preserve")
        body = response_payload(case, self.PRIMARY_DIMENSIONS)
        self.assertTrue(RUNNER.validate_case_response(
            case, self.PRIMARY_DIMENSIONS, 200, body, QUOTE_LIMITS["orca"],
        )[0])
        body["build_volume_limits_mm"]["max"] = dict(
            RUNNER.P1S_LIMITS_BY_ENGINE["orca"]
        )
        self.assertEqual(
            RUNNER.validate_case_response(
                case, self.PRIMARY_DIMENSIONS, 200, body, QUOTE_LIMITS["orca"],
            )[1],
            "build_volume_limits_invalid",
        )

    def test_oriented_dimensions_unavailable_path_is_typed_and_bare(self):
        case = RUNNER._case(
            "unit-oriented-unavailable",
            "orca",
            "P1S",
            "j3b_zero_normal_60x60x240",
            "preserve",
            422,
            expected_original_dimensions_available=None,
            expected_error_code="MODEL_DIMENSIONS_UNAVAILABLE",
        )
        body = response_payload(case, {"x": 60.0, "y": 60.0, "z": 240.0})
        self.assertEqual(
            RUNNER.validate_case_response(
                case,
                {"x": 60.0, "y": 60.0, "z": 240.0},
                422,
                body,
            ),
            (True, "oriented_dimensions_unavailable_typed_422_valid"),
        )
        body["model_transform"] = transform_payload(
            find_case("orca-zero-normal-explicit-auto-degraded-original"),
            {"x": 60.0, "y": 60.0, "z": 240.0},
        )
        self.assertEqual(
            RUNNER.validate_case_response(
                case,
                {"x": 60.0, "y": 60.0, "z": 240.0},
                422,
                body,
            )[1],
            "model_dimensions_unavailable_payload_invalid",
        )


class RequestAndPrivacyTests(unittest.TestCase):
    PRIMARY_DIMENSIONS = {"x": 20.0, "y": 255.0, "z": 255.0}

    def test_run_case_uses_common_multipart_helper_without_exposing_credential(self):
        case = find_case("orca-h2d-quote-primary-preserve")
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
                    QUOTE_LIMITS["orca"],
                    accepted_native_probe,
                )

        self.assertTrue(result.success)
        self.assertEqual(result.duration_sec, 1.25)
        kwargs = request.call_args.kwargs
        self.assertEqual(kwargs["slice_service_api_key"], "unit-only-secret")
        self.assertEqual(kwargs["layer_height"], case.layer_height)
        self.assertEqual(kwargs["extra_fields"]["orientationMode"], "preserve")
        self.assertEqual(
            kwargs["extra_fields"]["printerProfile"],
            "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json",
        )

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
                    expected_limits(case),
                    accepted_native_probe,
                )

        self.assertTrue(result.success)
        self.assertAlmostEqual(result.duration_sec, 0.3)
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertFalse(hasattr(result, "raw_body"))

    def test_normal_row_stops_before_http_when_exact_native_precondition_fails(self):
        case = find_case("prusa-p1s-primary-explicit-auto")
        rejected = RUNNER.NativeInfoObservation(
            False, None, 1, "native_info_rejected",
        )
        with mock.patch.object(RUNNER, "curl_multipart_slice") as request:
            result = RUNNER.run_case(
                "https://owner-target.invalid",
                "unit-only-secret",
                case,
                Path("synthetic.stl"),
                self.PRIMARY_DIMENSIONS,
                expected_limits(case),
                native_info_probe=lambda _: rejected,
            )

        self.assertFalse(result.success)
        self.assertEqual(result.http_status, 0)
        self.assertEqual(
            result.observation,
            "fixture_native_info_precondition_failed_service_not_evaluated",
        )
        request.assert_not_called()

    def test_deliberate_zero_normal_row_is_not_admitted_to_normal_precondition(self):
        case = find_case("prusa-zero-normal-explicit-auto-degraded-original")
        dimensions = {"x": 60.0, "y": 60.0, "z": 240.0}
        probe = mock.Mock(side_effect=AssertionError("normal precondition must not run"))
        with mock.patch.object(
            RUNNER,
            "curl_multipart_slice",
            return_value=(200, response_payload(case, dimensions), 0.5),
        ):
            result = RUNNER.run_case(
                "https://owner-target.invalid",
                "unit-only-secret",
                case,
                Path("zero-normal.stl"),
                dimensions,
                expected_limits(case),
                native_info_probe=probe,
            )

        self.assertTrue(result.success)
        probe.assert_not_called()
        self.assertIn(
            "deliberate_zero_normal_excluded_from_normal_precondition",
            result.observation,
        )

    def test_report_redacts_external_host_ip_credentials_and_temporary_paths(self):
        sensitive_url = "https://203.0.113.77:443"
        fixture = RUNNER.FixtureObservation(
            key="synthetic",
            expected_dimensions_mm={"x": 20.0, "y": 255.0, "z": 255.0},
            measured_dimensions_mm={"x": 20.0, "y": 255.0, "z": 255.0},
            fixture_kind="normal-ascii",
            facet_normals_valid=True,
            native_info_expectation="accepted-with-positive-requested-dimensions",
            native_info_observation="native_info_accepted",
            success=True,
        )
        result = RUNNER.CaseResult(
            key="synthetic-case",
            endpoint="/orca/slice",
            printer="P1S",
            requested_mode="auto",
            requested_rotation_deg=(0.0, 0.0, 0.0),
            fixture_key="synthetic",
            layer_height=0.2,
            expected_status=200,
            http_status=200,
            error_code=None,
            success=True,
            duration_sec=1.0,
            observation="fixture_native_info_precondition_passed;schema2_k3_success_and_height_invariant_valid",
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            original_results_dir = RUNNER.RESULTS_DIR
            original_report_path = RUNNER.REPORT_PATH
            try:
                RUNNER.RESULTS_DIR = Path(temporary_directory)
                RUNNER.REPORT_PATH = Path(temporary_directory) / "report.md"
                RUNNER.write_report(
                    sensitive_url,
                    200,
                    True,
                    [fixture],
                    [result],
                    native_info_command_source="configured",
                )
                report = RUNNER.REPORT_PATH.read_text(encoding="utf-8")
            finally:
                RUNNER.RESULTS_DIR = original_results_dir
                RUNNER.REPORT_PATH = original_report_path

        self.assertIn("Target class: **external-redacted**", report)
        self.assertIn("Native-info command source: **configured**", report)
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
            exit_code = RUNNER.main([])

        self.assertEqual(exit_code, 1)
        health.assert_not_called()
        write_report.assert_not_called()
        self.assertNotIn("target.invalid", output.getvalue())

    def test_main_gates_matrix_on_catalogue_v2_and_passes_resolved_limits(self):
        paths = {
            spec.key: Path(f"{spec.key}.stl")
            for spec in RUNNER.FIXTURE_SPECS
        }
        measurements = {
            spec.key: {
                axis: spec.dimensions_mm[index]
                for index, axis in enumerate(RUNNER.AXES)
            }
            for spec in RUNNER.FIXTURE_SPECS
        }
        fixture = RUNNER.FixtureObservation(
            key="qualified-fixtures",
            expected_dimensions_mm={"x": 1.0, "y": 1.0, "z": 1.0},
            measured_dimensions_mm={"x": 1.0, "y": 1.0, "z": 1.0},
            fixture_kind="normal-ascii",
            facet_normals_valid=True,
            native_info_expectation="accepted-with-positive-requested-dimensions",
            native_info_observation="native_info_accepted",
            success=True,
        )

        def successful_case(*args, **_kwargs):
            case = args[2]
            return RUNNER.CaseResult(
                key=case.key,
                endpoint=case.endpoint,
                printer=case.printer,
                requested_mode=case.expected_mode,
                requested_rotation_deg=case.requested_rotation_deg,
                fixture_key=case.fixture_key,
                layer_height=case.layer_height,
                expected_status=case.expected_status,
                http_status=case.expected_status,
                error_code=case.expected_error_code,
                success=True,
                duration_sec=0.1,
                observation="synthetic-pass",
            )

        with (
            mock.patch.object(RUNNER, "resolve_base_url", return_value="https://target.invalid"),
            mock.patch.object(RUNNER, "resolve_slice_service_api_key", return_value="secret"),
            mock.patch.object(
                RUNNER,
                "curl_json",
                side_effect=[(200, {"status": "OK"}), (200, catalogue_body())],
            ) as get_json,
            mock.patch.object(
                RUNNER,
                "write_and_measure_fixtures",
                return_value=(paths, measurements, [fixture]),
            ),
            mock.patch.object(RUNNER, "run_case", side_effect=successful_case) as run_case_mock,
            mock.patch.object(RUNNER, "write_report") as write_report,
            redirect_stdout(io.StringIO()),
        ):
            exit_code = RUNNER.main([])

        self.assertEqual(exit_code, 0)
        self.assertEqual(get_json.call_count, 2)
        self.assertEqual(get_json.call_args_list[1].kwargs["endpoint"], "/profiles")
        self.assertEqual(run_case_mock.call_count, len(RUNNER.build_cases()))
        quote_call = next(
            call for call in run_case_mock.call_args_list
            if call.args[2].key == "orca-h2d-quote-primary-preserve"
        )
        self.assertEqual(quote_call.args[5], QUOTE_LIMITS["orca"])
        write_report.assert_called_once()


if __name__ == "__main__":
    unittest.main()
