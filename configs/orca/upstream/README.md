# Vendored Orca parent profiles

These JSON files are semantic copies of OrcaSlicer v2.3.1's `Custom` parent
profiles and are the runtime resolver's versioned source. The Docker build fails
closed unless their canonical JSON semantics match the exact pinned native
resources under `/opt/orcaslicer/resources/profiles/Custom`.

The pinned parent has its own upstream layer hooks and remains byte-semantically
unchanged. Orca's relative-extrusion validation specifically requires the
selected repository child machine to own `layer_change_gcode='G92 E0'`;
`before_layer_change_gcode` and the runtime process key `layer_gcode` do not
replace that contract. Runtime derivation still clears process `layer_gcode`
and uses `use_relative_e_distances='1'`. Keep the child override, runtime
settings, and exact-image direct native smoke aligned. That smoke accepts
positive `G1 ... E`
only after the exact `;BEFORE_LAYER_CHANGE` marker, so purge/prelude motion does
not count as model-layer extrusion.

Upstream source:

- <https://github.com/OrcaSlicer/OrcaSlicer/tree/v2.3.1/resources/profiles/Custom>

Do not edit these profiles independently. A native-version upgrade must update
the pinned AppImage, these vendored copies, the build-time semantic-equality
gate, and the effective-profile mutation tests together.
