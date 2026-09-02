"""CAD-to-STL conversion utility.

Converts supported CAD interchange formats into STL meshes without applying
automatic geometry healing or shape correction to preserve source fidelity.

Invalid source geometry (an HTML download instead of CAD, an unloadable
file, a model without surfaces, or a mesh that produced no triangles) is
reported through one machine-readable marker line,
``INVALID_SOURCE_GEOMETRY|<short reason>``, written to both stdout and
stderr with exit status 2. Infrastructure failures keep exit status 1.
"""

import os
import shutil
import sys

import gmsh


GEOMETRY_MARKER = "INVALID_SOURCE_GEOMETRY"
GEOMETRY_EXIT_CODE = 2


class UserFileError(ValueError):
    """Raised when the uploaded CAD file is invalid."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _short_reason(reason):
    """Bound a reason to one short printable ASCII token without separators."""
    text = "".join(ch for ch in str(reason) if 0x20 <= ord(ch) <= 0x7E)
    text = text.replace("|", "/").strip()
    return (text[:80] or "unspecified")


def report_invalid_geometry(reason):
    """Emit the marker line on both streams and exit with the geometry status."""
    marker = f"{GEOMETRY_MARKER}|{_short_reason(reason)}"
    print(marker)
    sys.stdout.flush()
    print(marker, file=sys.stderr)
    sys.stderr.flush()
    sys.exit(GEOMETRY_EXIT_CODE)


def _check_not_html(path):
    """Reject files that are actually downloaded HTML pages."""
    with open(path, 'rb') as file_obj:
        header = file_obj.read(256)

    try:
        text_header = header.decode('ascii', errors='ignore').lower()
    except Exception:
        return

    if "<!doctype html" in text_header or "<html" in text_header:
        raise UserFileError("html document instead of cad")


def _assert_has_surfaces():
    """Require at least one surface or volume entity after import."""
    surfaces = gmsh.model.getEntities(2)
    volumes = gmsh.model.getEntities(3)
    if len(surfaces) == 0 and len(volumes) == 0:
        raise UserFileError("no surfaces in cad model")


def _assert_mesh_generated():
    """Require a non-empty triangle mesh before writing STL."""
    node_tags, _coordinates, _parametric = gmsh.model.mesh.getNodes()
    if len(node_tags) == 0:
        raise UserFileError("mesh has no nodes")
    element_types, element_tags, _node_tags = gmsh.model.mesh.getElements(2)
    total = sum(len(tags) for tags in element_tags)
    if len(element_types) == 0 or total == 0:
        raise UserFileError("mesh has no triangles")


def convert_cad_to_stl(input_path, output_path):
    """Convert a CAD file to STL format.

    Args:
        input_path: Path to the source CAD file (.iges, .igs, .step, .stp).
        output_path: Destination STL output path.

    Returns:
        None. Writes STL output to disk.

    Raises:
        SystemExit: Status 2 with the geometry marker for invalid source
            geometry, status 1 for every other failure.
    """
    input_abs_path = os.path.abspath(input_path)
    output_abs_path = os.path.abspath(output_path)

    print(f"[PYTHON CAD] Processing: {os.path.basename(input_abs_path)}")

    if not os.path.exists(input_abs_path):
        print("[PYTHON CAD] ERROR: Input CAD file was not found.")
        sys.exit(1)

    # 1. HTML check. An I/O failure while reading the header is a server-side
    # fault, not the customer's geometry: exit 1 without the marker.
    try:
        _check_not_html(input_abs_path)
    except UserFileError as error:
        report_invalid_geometry(error.reason)
    except (MemoryError, OSError) as error:
        print(f"[PYTHON CAD] ERROR: Could not read this CAD file. {type(error).__name__}")
        sys.exit(1)

    # 2. File extension handling
    temp_igs_path = input_abs_path
    created_temp_copy = False
    if input_abs_path.lower().endswith('.iges'):
        temp_igs_path = os.path.splitext(input_abs_path)[0] + '.igs'
        shutil.copy2(input_abs_path, temp_igs_path)
        created_temp_copy = True

    geometry_failure = None
    try:
        gmsh.initialize()
        gmsh.option.setNumber("General.Terminal", 1)
        gmsh.option.setNumber("General.Verbosity", 2)

        # 3. Loading and merging. Resource exhaustion and I/O failures are
        # server-side faults: they propagate to the plain exit-1 branch below
        # and are never reported as the customer's bad geometry.
        print("[PYTHON CAD] Merging file...")
        try:
            gmsh.merge(temp_igs_path)
        except (MemoryError, OSError):
            raise
        except Exception as error:  # noqa: BLE001 - loader failure is a bad source
            raise UserFileError(f"unloadable {type(error).__name__}") from error

        # 4. Synchronize imported geometry and require real surfaces
        gmsh.model.occ.synchronize()
        _assert_has_surfaces()

        # 5. Exporting to STL
        gmsh.option.setNumber("Mesh.MeshSizeMin", 0.5)
        gmsh.option.setNumber("Mesh.MeshSizeMax", 5.0)

        try:
            gmsh.model.mesh.generate(2)
        except (MemoryError, OSError):
            raise
        except Exception as error:  # noqa: BLE001 - meshing failure is a bad source
            raise UserFileError(f"mesh generation failed {type(error).__name__}") from error
        _assert_mesh_generated()

        # 6. Save
        gmsh.write(output_abs_path)
        print(f"[PYTHON CAD] Success! Exported to {os.path.basename(output_abs_path)}")

    except UserFileError as error:
        geometry_failure = error.reason
    except Exception as error:  # noqa: BLE001
        print(f"[PYTHON CAD] ERROR: Could not convert this CAD file. {type(error).__name__}")
        sys.exit(1)
    finally:
        if gmsh.isInitialized():
            gmsh.finalize()
        if created_temp_copy and os.path.exists(temp_igs_path):
            try:
                os.remove(temp_igs_path)
            except OSError:
                pass

    if geometry_failure is not None:
        report_invalid_geometry(geometry_failure)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 cad2stl.py input.(iges|igs|step|stp) output.stl")
        sys.exit(1)

    convert_cad_to_stl(sys.argv[1], sys.argv[2])
