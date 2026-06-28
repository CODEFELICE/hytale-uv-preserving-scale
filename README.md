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
* **Pivot** — model origin, the selected root, or a custom point. Choosing "Selected Hierarchy" defaults the pivot to the selected root, so the part scales in place instead of moving toward the world origin.
* **Scale loaded position animations** — also multiply position keyframes by the factor. Rotation, stretch, visibility and UV channels are left alone, and only animations loaded in the project are touched.

## Bake pose into model

The plugin also wraps Blockbench's **Bake Animation Pose into Model**. Baking a pose changes the model's rest pose, which would normally break your other animations — they're stored relative to the old rest. With the re-base option (on by default in the popup), every loaded animation is shifted onto the new rest pose in the same undo step, so they keep playing. Rotation is re-based through quaternions so it matches Hytale's interpolation exactly; position is shifted too. Scale is left to the native action, which doesn't bake it. Untick the option for the plain native bake.

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
