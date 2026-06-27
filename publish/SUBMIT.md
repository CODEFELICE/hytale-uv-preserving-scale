# Submitting to the in-app Blockbench plugin store

The in-app store (**File → Plugins → Available** tab, one-click *Install*, auto-updates) is the
central registry [`JannisX11/blockbench-plugins`](https://github.com/JannisX11/blockbench-plugins).
You get in by opening a Pull Request. This folder contains a ready, **validator-passing** package.

## What's in this folder

```
publish/
├── hytale_uv_preserving_scale/      <- copy this whole folder into the repo's plugins/ dir
│   ├── hytale_uv_preserving_scale.js  (the built plugin)
│   ├── about.md                       (shown in the plugin browser)
│   ├── LICENSE.MD                     (MIT — edit the name/year if needed)
│   └── members.yml                    (EDIT: put your GitHub username)
├── plugins.entry.json               <- merge this object into the repo's plugins.json
└── SUBMIT.md                        (this file)
```

## Steps

1. **Edit `members.yml`** — replace `YOUR_GITHUB_USERNAME` with your GitHub handle. (Optionally adjust `LICENSE.MD`.)
2. **Fork & clone** https://github.com/JannisX11/blockbench-plugins and run `npm install`.
3. **Copy** `publish/hytale_uv_preserving_scale/` → `<repo>/plugins/hytale_uv_preserving_scale/`.
4. **Add the entry** from `plugins.entry.json` into `<repo>/plugins.json` (it's a big JSON object keyed by plugin id; add the `"hytale_uv_preserving_scale": { ... }` entry, keep Tab indentation, mind the commas).
5. **Validate**: `npm run validate hytale_uv_preserving_scale` → must print *"passed validation with no errors!"*.
6. **Commit & open a PR**. A maintainer reviews it (the list is lightly curated). Once merged it appears in the Available tab.

## Must match exactly

The plugin metadata in `hytale_uv_preserving_scale.js` (the `Plugin.register(...)` call) and the
`plugins.json` entry are compared field-by-field by the validator. If you add any field (e.g.
`repository`, `bug_tracker`, `website`), add it to **both** with the **same** value, and re-run the
validator. Do **not** put an `about` field in the metadata — the about text lives in `about.md`.

## Updates later

To push an update that auto-installs for existing users, bump `"version"` in **both**
`hytale_uv_preserving_scale.js` and `plugins.json` (semver, e.g. `1.0.1`), then open another PR.
To add a changelog, include `changelog.json` and set `has_changelog: true` in **both** places.

## Optional polish

* Add a custom **icon**: drop a 48–96px `icon.png` or `icon.svg` (≤12 KB) in the folder and change
  `"icon"` to the filename in **both** the JS and `plugins.json` (currently it uses the built-in
  Material icon `photo_size_select_large`, which is valid as-is).

---

### Alternatives to the store

* **Direct file** (works today): send people `hytale_uv_preserving_scale.js`; they use
  *File → Plugins → ⋮ → Load Plugin from File*.
* **From a URL**: host the `.js` (e.g. a GitHub raw link or release asset); they use
  *Load Plugin from URL*. Good for betas. (No automatic updates — only the store auto-updates.)

In all cases users also need the official Hytale plugin installed, since it provides the
`hytale_character` / `hytale_prop` formats this add-on attaches to.
