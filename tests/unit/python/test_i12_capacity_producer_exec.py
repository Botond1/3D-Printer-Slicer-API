import importlib.util
import stat
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts" / "i12-capacity-producer-exec.py"
SPEC = importlib.util.spec_from_file_location("i12_capacity_producer_exec", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def valid_arguments() -> list[str]:
    return [
        "--service-uid", "1234",
        "--service-gid", "1235",
        "--slicer-base-url-file", "/run/credentials/slicer-base-url",
        "--slice-service-api-key-file", "/run/credentials/slice-key",
        "--operations-api-key-file", "/run/credentials/operations-key",
        "--artifact-api-key-file", "/run/credentials/artifact-key",
        "--count", "3",
        "--expected-max-concurrent", "2",
        "--cleanup-manifest", "/run/evidence/queue-cleanup.json",
        "--report", "/run/evidence/queue-report.md",
    ]


def metadata(**changes):
    values = {
        "st_dev": 11,
        "st_ino": 22,
        "st_mode": stat.S_IFREG | 0o600,
        "st_uid": 0,
        "st_gid": 0,
        "st_nlink": 1,
        "st_size": 32,
        "st_mtime_ns": 33,
        "st_ctime_ns": 44,
    }
    values.update(changes)
    return types.SimpleNamespace(**values)


class CredentialRuntime:
    O_RDONLY = 1
    O_CLOEXEC = 2
    O_NOFOLLOW = 4

    def __init__(self, content: bytes, states=None):
        self.path = types.SimpleNamespace(realpath=lambda value: value)
        self.content = content
        self.states = list(states or [metadata(st_size=len(content))] * 4)
        self.read_calls = 0
        self.closed = []
        self.opened = []

    def lstat(self, _path):
        return self.states.pop(0)

    def open(self, path, flags):
        self.opened.append((path, flags))
        return 9

    def fstat(self, _descriptor):
        return self.states.pop(0)

    def read(self, _descriptor, maximum):
        self.read_calls += 1
        return self.content[:maximum] if self.read_calls == 1 else b""

    def close(self, descriptor):
        self.closed.append(descriptor)


class ExecveObserved(Exception):
    pass


class LaunchRuntime:
    def __init__(self):
        self.calls = []
        self.uid = (0, 0, 0)
        self.gid = (0, 0, 0)
        self.groups = [27]

    def geteuid(self):
        self.calls.append("geteuid")
        return 0

    def setgroups(self, groups):
        self.calls.append(("setgroups", groups))
        self.groups = list(groups)

    def setresgid(self, real, effective, saved):
        self.calls.append(("setresgid", real, effective, saved))
        self.gid = (real, effective, saved)

    def setresuid(self, real, effective, saved):
        self.calls.append(("setresuid", real, effective, saved))
        self.uid = (real, effective, saved)

    def getresgid(self):
        self.calls.append("getresgid")
        return self.gid

    def getresuid(self):
        self.calls.append("getresuid")
        return self.uid

    def getgroups(self):
        self.calls.append("getgroups")
        return self.groups

    def execve(self, executable, argv, environment):
        self.calls.append(("execve", executable, argv, environment))
        raise ExecveObserved


class CapacityProducerExecTests(unittest.TestCase):
    def test_plan_keeps_secrets_out_of_argv_and_uses_exact_environment(self):
        secrets = {
            "/run/credentials/slicer-base-url": "http://172.19.0.2:3000",
            "/run/credentials/slice-key": "S" * 32,
            "/run/credentials/operations-key": "O" * 32,
            "/run/credentials/artifact-key": "A" * 32,
        }
        observed = []

        def reader(path, *, minimum_bytes, maximum_bytes):
            observed.append((path, minimum_bytes, maximum_bytes))
            return secrets[path]

        plan = MODULE.build_launch_plan(
            valid_arguments(),
            credential_reader=reader,
            runner_resolver=lambda: "/verified/tests/testing-scripts/queue/queue_concurrency_test_runner.py",
        )

        self.assertEqual(plan.service_uid, 1234)
        self.assertEqual(plan.service_gid, 1235)
        self.assertEqual(tuple(plan.environment), MODULE.ENVIRONMENT_NAMES)
        self.assertEqual(set(plan.environment.values()), set(secrets.values()))
        self.assertEqual(plan.argv[0], "/usr/bin/python3")
        self.assertEqual(plan.argv[1], "/verified/tests/testing-scripts/queue/queue_concurrency_test_runner.py")
        for secret in secrets.values():
            self.assertFalse(any(secret in argument for argument in plan.argv))
        self.assertEqual(
            observed,
            [
                ("/run/credentials/slicer-base-url", 1, 2048),
                ("/run/credentials/slice-key", 32, 256),
                ("/run/credentials/operations-key", 32, 256),
                ("/run/credentials/artifact-key", 32, 256),
            ],
        )

    def test_argument_contract_rejects_root_noncanonical_and_extra_inputs(self):
        cases = []
        for option, value in (
            ("--service-uid", "0"),
            ("--service-gid", "00"),
            ("--count", "4"),
            ("--expected-max-concurrent", "+2"),
            ("--cleanup-manifest", "relative.json"),
            ("--report", "/run/evidence/../report.md"),
        ):
            candidate = valid_arguments()
            candidate[candidate.index(option) + 1] = value
            cases.append((option, candidate))
        cases.append(("extra", [*valid_arguments(), "--extra", "value"]))
        cases.append(("reordered", valid_arguments()[2:4] + valid_arguments()[0:2] + valid_arguments()[4:]))

        for label, candidate in cases:
            with self.subTest(label=label), self.assertRaises(MODULE.ContractError):
                MODULE.build_launch_plan(
                    candidate,
                    credential_reader=lambda *_args, **_kwargs: "X" * 32,
                    runner_resolver=lambda: "/verified/runner.py",
                )

    def test_credential_reader_is_nofollow_root_owned_exact_mode_and_bounded(self):
        content = b"K" * 32
        runtime = CredentialRuntime(content)
        value = MODULE.read_root_credential(
            "/run/credentials/key",
            minimum_bytes=32,
            maximum_bytes=256,
            runtime=runtime,
        )
        self.assertEqual(value, content.decode("ascii"))
        self.assertEqual(runtime.opened, [("/run/credentials/key", 7)])
        self.assertEqual(runtime.closed, [9])
        self.assertEqual(runtime.read_calls, 2)

    def test_credential_metadata_and_content_mutations_fail_closed(self):
        invalid_metadata = (
            metadata(st_mode=stat.S_IFLNK | 0o600),
            metadata(st_uid=1000),
            metadata(st_gid=1000),
            metadata(st_mode=stat.S_IFREG | 0o640),
            metadata(st_nlink=2),
            metadata(st_size=31),
            metadata(st_size=257),
        )
        for candidate in invalid_metadata:
            with self.subTest(candidate=candidate), self.assertRaises(MODULE.ContractError):
                MODULE._validate_credential_metadata(candidate, minimum_bytes=32, maximum_bytes=256)

        for content in (b"K" * 31, b"K" * 257, b"K" * 31 + b"\n", b"K" * 31 + b"\xff"):
            runtime = CredentialRuntime(content)
            with self.subTest(content_length=len(content)), self.assertRaises(MODULE.ContractError):
                MODULE.read_root_credential(
                    "/run/credentials/key",
                    minimum_bytes=32,
                    maximum_bytes=256,
                    runtime=runtime,
                )

    def test_privilege_drop_precedes_direct_execve_with_exact_environment(self):
        environment = {
            "SLICER_BASE_URL": "http://172.19.0.2:3000",
            "SLICE_SERVICE_API_KEY": "S" * 32,
            "OPERATIONS_API_KEY": "O" * 32,
            "ARTIFACT_API_KEY": "A" * 32,
        }
        plan = MODULE.LaunchPlan(
            1234,
            1235,
            ("/usr/bin/python3", "/verified/runner.py", "--count", "3"),
            environment,
        )
        runtime = LaunchRuntime()
        with self.assertRaises(ExecveObserved):
            MODULE.execute_launch_plan(
                plan,
                runtime=runtime,
                no_new_privileges=lambda: runtime.calls.append("no_new_privileges"),
            )
        self.assertEqual(
            runtime.calls[:-1],
            [
                "geteuid",
                "no_new_privileges",
                ("setgroups", []),
                ("setresgid", 1235, 1235, 1235),
                ("setresuid", 1234, 1234, 1234),
                "getresgid",
                "getresuid",
                "getgroups",
            ],
        )
        exec_call = runtime.calls[-1]
        self.assertEqual(exec_call[0:2], ("execve", "/usr/bin/python3"))
        self.assertEqual(exec_call[2], list(plan.argv))
        self.assertEqual(exec_call[3], environment)

    def test_direct_exec_rejects_root_extra_environment_and_secret_argv(self):
        base_environment = {
            "SLICER_BASE_URL": "http://172.19.0.2:3000",
            "SLICE_SERVICE_API_KEY": "S" * 32,
            "OPERATIONS_API_KEY": "O" * 32,
            "ARTIFACT_API_KEY": "A" * 32,
        }
        cases = (
            MODULE.LaunchPlan(0, 1235, ("/usr/bin/python3", "/runner.py"), base_environment),
            MODULE.LaunchPlan(1234, 0, ("/usr/bin/python3", "/runner.py"), base_environment),
            MODULE.LaunchPlan(
                1234, 1235, ("/usr/bin/python3", "/runner.py"), {**base_environment, "PATH": "/bin"}
            ),
            MODULE.LaunchPlan(
                1234,
                1235,
                ("/usr/bin/python3", "/runner.py", "S" * 32),
                base_environment,
            ),
        )
        for plan in cases:
            with self.subTest(plan=plan), self.assertRaises(MODULE.ContractError):
                MODULE.execute_launch_plan(plan, runtime=LaunchRuntime(), no_new_privileges=lambda: None)


if __name__ == "__main__":
    unittest.main()
