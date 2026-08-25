# Vendored Orca parent profiles

These JSON files are semantic copies of OrcaSlicer v2.3.1's `Custom` parent
profiles and are the runtime resolver's versioned source. The Docker build fails
closed unless their canonical JSON semantics match the exact pinned native
resources under `/opt/orcaslicer/resources/profiles/Custom`.

The flattened machine parent supplies a per-layer `G92 E0` reset. Runtime
derivation therefore clears `layer_gcode` and uses relative extrusion through
`use_relative_e_distances='1'`; keep that setting aligned with the parent and
the exact-image direct native smoke. That smoke accepts positive `G1 ... E`
only after the exact `;BEFORE_LAYER_CHANGE` marker, so purge/prelude motion does
not count as model-layer extrusion.

Upstream source:

- <https://github.com/OrcaSlicer/OrcaSlicer/tree/v2.3.1/resources/profiles/Custom>

Do not edit these profiles independently. A native-version upgrade must update
the pinned AppImage, these vendored copies, the build-time semantic-equality
gate, and the effective-profile mutation tests together.
