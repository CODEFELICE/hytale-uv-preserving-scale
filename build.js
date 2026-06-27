/*
 * Build script for Hytale UV-Preserving Scale.
 *
 * The plugin is authored as a single, dependency-free, standard-JS file that
 * Blockbench (Electron/Chromium) runs directly — no transpilation is required.
 * This script therefore performs a "thin" build: it validates the source,
 * stamps a version banner, and copies it to dist/ as the installable artifact.
 *
 * Usage:  node build.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = __dirname;
var SRC = path.join(ROOT, 'src', 'hytale_uv_preserving_scale.js');
var OUT_DIR = path.join(ROOT, 'dist');
var OUT = path.join(OUT_DIR, 'hytale_uv_preserving_scale.js');

function read(p) { return fs.readFileSync(p, 'utf8'); }

var pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
var source = read(SRC);

// 1. Validate syntax without executing (catches typos before shipping).
try {
	new vm.Script(source, { filename: SRC });
} catch (err) {
	console.error('✗ Source failed to parse:\n  ' + err.message);
	process.exit(1);
}

// 2. Sanity check: the registered plugin id must match the output filename.
if (source.indexOf("var PLUGIN_ID = 'hytale_uv_preserving_scale'") === -1) {
	console.error('✗ PLUGIN_ID does not match the expected id "hytale_uv_preserving_scale".');
	process.exit(1);
}

// 3. Stamp a banner and write the installable file.
var banner =
	'/*! Hytale UV-Preserving Scale v' + pkg.version + ' | MIT */\n';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, banner + source, 'utf8');

// 4. Re-validate the emitted file.
try {
	new vm.Script(read(OUT), { filename: OUT });
} catch (err) {
	console.error('✗ Emitted file failed to parse:\n  ' + err.message);
	process.exit(1);
}

var bytes = fs.statSync(OUT).size;
console.log('✓ Built ' + path.relative(ROOT, OUT) + ' (' + bytes + ' bytes, v' + pkg.version + ')');
