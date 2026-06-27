# Hytale UV-Preserving Scale

A [Blockbench](https://www.blockbench.net/) plugin that scales a Hytale model up or down without touching its UVs.

Resizing a cube in the Hytale format changes its UV size, so you'd normally have to redo texture work after scaling. This plugin keeps every cube's base size and scales the *visible* geometry through each cube's `stretch` instead (and moves the pivots and origins to match). The model changes size; the texture layout doesn't.

Works with the **Hytale Character** and **Hytale Prop** formats. It's a standalone add-on for the official Hytale plugin and doesn't modify it.

## Install

Grab `dist/hytale_uv_preserving_scale.js` and load it via **Settings → Plugins → ⋮ → Load Plugin from File**. You also need the official Hytale plugin installed, since it provides the formats.

The action shows up under **Tools → Scale Model — Preserve UV** when a Hytale project is open.

## Usage

* **Scale factor** — 0.1 to 10, with presets (×0.25, ×0.5, ×2, ×4). Factor 1 does nothing.
* **Scope** — the whole model, or just the selected hierarchy.
* **Pivot** — model origin, the selected root, or a custom point.
* **Scale loaded position animations** — also multiply position keyframes by the factor. Rotation, stretch, visibility and UV channels are left alone, and only animations loaded in the project are touched.

It runs as a single undo step. If something looks off after the transform it rolls back instead of leaving the model half-scaled.

## What changes, what doesn't

Scaled: node positions, group origins, cube centers and pivots, hierarchy offsets, cube `stretch`, and (optionally) position keyframes.

Left alone: base cube size, every UV, UV rotation and mirroring, textures, cube rotations, visibility, shading, the hierarchy, names, and the rotation/stretch/visibility/UV animation channels.

## Develop

Plain JavaScript, no build step needed to run it — `dist/` is just the source with a version banner. The tooling is Node-only and has no runtime dependencies:

```bash
npm run build    # write dist/
npm test         # unit + integration tests
npm run sim      # run the built plugin against a mocked Blockbench
```

The tests run without Blockbench. `test/harness.js` reimplements the official `.blockymodel` / `.blockyanim` export, so the integration test can scale a model, export it before and after, and diff the two.

## License

MIT
