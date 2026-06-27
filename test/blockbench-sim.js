/*
 * Blockbench environment simulation for Hytale UV-Preserving Scale.
 *
 * This loads the BUILT plugin (dist/hytale_uv_preserving_scale.js) inside a
 * mocked Blockbench global environment and drives the real code paths that the
 * pure unit tests cannot reach: plugin registration, the Tools-menu action, the
 * dialog, scope/pivot resolution, the single undo-safe transaction, animation
 * scaling, the unsupported-element abort, rollback on failure, and onunload
 * cleanup.
 *
 * Run with:  node test/blockbench-sim.js
 *
 * NOTE: harness.js is required FIRST (while `Plugin` is still undefined) so the
 * shared mock element classes load cleanly; only then do we install the
 * Blockbench globals and load the dist file (which then registers the plugin).
 */

'use strict';

var assert = require('assert');
var path = require('path');
var H = require('./harness.js'); // requires src with Plugin undefined -> exports PURE
var P = H.PURE;

/* ----------------------------- tiny runner -------------------------- */

var passed = 0, failed = 0, failures = [];
function test(name, fn) {
	try { fn(); passed++; console.log('  ✓ ' + name); }
	catch (err) { failed++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + (err && err.message ? err.message : err)); }
}

/* ----------------------------- mock state --------------------------- */

var registered = null;       // {id, opts} captured from Plugin.register
var toolsActions = [];       // actions added to the Tools menu
var lastDialog = null;       // most recently constructed dialog
var deleted = { action: false, dialog: false };
var msgBoxes = [];           // Blockbench.showMessageBox calls
var quickMsgs = [];          // Blockbench.showQuickMessage calls
var undoLog = { init: 0, finish: 0, cancel: 0, lastAspects: null, lastLabel: null };
var canvasLog = { view: 0, bones: 0, origin: 0 };

function resetLogs() {
	msgBoxes.length = 0; quickMsgs.length = 0;
	undoLog.init = undoLog.finish = undoLog.cancel = 0; undoLog.lastAspects = null; undoLog.lastLabel = null;
	canvasLog.view = canvasLog.bones = canvasLog.origin = 0;
}

/* ----------------------------- install globals ---------------------- */

global.Group = H.MockGroup;
global.Cube = H.MockCube;
global.BoneAnimator = H.MockBoneAnimator;
global.Group.all = [];
global.Cube.all = [];
global.selected = [];

global.Outliner = { root: [] };
global.Format = { id: 'hytale_character' };
global.Project = { saved: true };
global.Animation = { all: [] };

global.Plugin = {
	register: function (id, opts) {
		registered = { id: id, opts: opts };
		if (typeof opts.onload === 'function') opts.onload();
		return { id: id };
	}
};

global.Action = function (id, opts) {
	this.id = id;
	for (var k in opts) this[k] = opts[k];
	this.delete = function () { deleted.action = true; };
};

global.MenuBar = { menus: { tools: { addAction: function (a) { toolsActions.push(a); } } } };

function collectDefaults(form) {
	var values = {};
	for (var key in form) {
		var f = form[key];
		if (f === '_' || !f || typeof f !== 'object') continue;
		if (f.type === 'buttons') continue;
		values[key] = (f.default !== undefined) ? f.default : f.value;
	}
	return values;
}

global.Dialog = function (id, opts) {
	this.id = id;
	this.opts = opts;
	this._values = collectDefaults(opts.form);
	lastDialog = this;
	var self = this;
	this.show = function () { if (typeof opts.onOpen === 'function') opts.onOpen.call(self); return self; };
	this.hide = function () { return self; };
	this.delete = function () { deleted.dialog = true; };
	this.getFormResult = function () { return Object.assign({}, self._values); };
	this.setFormValues = function (v) {
		Object.assign(self._values, v);
		if (typeof opts.onFormChange === 'function') opts.onFormChange.call(self, self.getFormResult());
	};
	this.confirm = function () { if (typeof opts.onConfirm === 'function') opts.onConfirm.call(self, self.getFormResult()); };
};

global.Blockbench = {
	showMessageBox: function (o, cb) { msgBoxes.push(o); if (cb) cb(0); },
	showQuickMessage: function (m) { quickMsgs.push(m); },
	isOlderThan: function () { return false; }
};

global.Canvas = {
	updateView: function () { canvasLog.view++; },
	updateAllBones: function () { canvasLog.bones++; },
	updateOrigin: function () { canvasLog.origin++; }
};

global.Undo = {
	initEdit: function (a) { undoLog.init++; undoLog.lastAspects = a; },
	finishEdit: function (l, a) { undoLog.finish++; undoLog.lastLabel = l; },
	cancelEdit: function () { undoLog.cancel++; }
};

global.document = {
	createElement: function () { return { innerHTML: '', textContent: '', className: '', style: {} }; }
};

/* ----------------------------- load the built plugin ---------------- */

require(path.join('..', 'dist', 'hytale_uv_preserving_scale.js'));

/* ----------------------------- helpers ------------------------------ */

function setProject(rootNodes) {
	global.Outliner.root = rootNodes;
	var groups = [], cubes = [];
	(function walk(list) {
		list.forEach(function (n) {
			if (n instanceof H.MockGroup) { groups.push(n); walk(n.children); }
			else if (n instanceof H.MockCube) cubes.push(n);
		});
	})(rootNodes);
	global.Group.all = groups;
	global.Cube.all = cubes;
}

function buildProject() {
	var root = new H.MockGroup({ name: 'body', origin: [0, 12, 0] });
	var bodyShape = new H.MockCube({ name: 'body', from: [-4, 8, -2], to: [4, 16, 2], origin: [0, 12, 0], stretch: [1.5, 0.75, 2] });
	bodyShape.faces.south.texture = 'tex'; bodyShape.faces.south.uv = [0, 0, 8, 8];
	root.add(bodyShape);
	var arm = new H.MockGroup({ name: 'arm', origin: [6, 14, 0], rotation: [0, 0, -30] });
	var armShape = new H.MockCube({ name: 'arm', from: [5, 6, -1], to: [7, 14, 1], origin: [6, 14, 0], stretch: [1, 1, 1] });
	armShape.faces.east.texture = 'tex'; armShape.faces.east.uv = [0, 0, 2, 8];
	arm.add(armShape);
	root.add(arm);
	return { roots: [root], root: root, bodyShape: bodyShape, arm: arm, armShape: armShape };
}

function clickAndConfirm(formValues) {
	resetLogs();
	var action = toolsActions[0];
	action.click();              // opens dialog
	if (formValues) lastDialog.setFormValues(formValues);
	lastDialog.confirm();        // triggers onConfirm
}

/* =================================================================== *
 *  Tests                                                              *
 * =================================================================== */

console.log('\nBlockbench environment simulation (drives the built dist plugin)');

test('plugin registers with correct metadata and adds a Tools action', function () {
	assert.ok(registered, 'Plugin.register was called');
	assert.strictEqual(registered.id, 'hytale_uv_preserving_scale', 'plugin id');
	assert.strictEqual(registered.opts.version, '1.0.0', 'version');
	assert.strictEqual(registered.opts.variant, 'both', 'variant both');
	assert.strictEqual(registered.opts.min_version, '5.0.5', 'min_version');
	assert.strictEqual(typeof registered.opts.onload, 'function', 'has onload');
	assert.strictEqual(typeof registered.opts.onunload, 'function', 'has onunload');
	assert.strictEqual(toolsActions.length, 1, 'one action added to Tools menu');
	assert.strictEqual(toolsActions[0].name, 'Scale Model — Preserve UV', 'action name');
});

test('action condition is true only for Hytale formats', function () {
	global.Format = { id: 'hytale_character' };
	assert.strictEqual(toolsActions[0].condition(), true, 'hytale_character');
	global.Format = { id: 'hytale_prop' };
	assert.strictEqual(toolsActions[0].condition(), true, 'hytale_prop');
	global.Format = { id: 'java_block' };
	assert.strictEqual(toolsActions[0].condition(), false, 'non-hytale');
	global.Format = { id: 'hytale_character' };
});

test('scaling ×0.5 (Entire Model, Model Origin) runs ONE undo transaction and scales correctly', function () {
	var proj = buildProject();
	setProject(proj.roots);
	global.Project.saved = true;

	clickAndConfirm({ factor: 0.5, scope: 'all', pivot: 'origin', scale_animations: false });

	// Exactly one undo transaction, no rollback.
	assert.strictEqual(undoLog.init, 1, 'initEdit once');
	assert.strictEqual(undoLog.finish, 1, 'finishEdit once');
	assert.strictEqual(undoLog.cancel, 0, 'no cancelEdit');
	assert.strictEqual(undoLog.lastLabel, 'Scale Hytale model while preserving UVs', 'undo label');
	// Aspects include cubes, groups and the outliner.
	assert.ok(Array.isArray(undoLog.lastAspects.elements) && undoLog.lastAspects.elements.length === 2, 'elements aspect = 2 cubes');
	assert.ok(Array.isArray(undoLog.lastAspects.groups) && undoLog.lastAspects.groups.length === 2, 'groups aspect = 2 groups');
	assert.strictEqual(undoLog.lastAspects.outliner, true, 'outliner aspect');

	// Geometry: stretch halved, size unchanged, origins halved.
	assert.deepStrictEqual(proj.bodyShape.stretch, [0.75, 0.375, 1], 'body stretch halved');
	assert.deepStrictEqual([proj.bodyShape.to[0] - proj.bodyShape.from[0], proj.bodyShape.to[1] - proj.bodyShape.from[1], proj.bodyShape.to[2] - proj.bodyShape.from[2]], [8, 8, 4], 'body base size unchanged');
	assert.deepStrictEqual(proj.root.origin, [0, 6, 0], 'body bone origin halved');
	assert.deepStrictEqual(proj.arm.origin, [3, 7, 0], 'arm bone origin halved');
	assert.deepStrictEqual(proj.arm.rotation, [0, 0, -30], 'arm rotation unchanged');
	// UV untouched.
	assert.deepStrictEqual(proj.bodyShape.faces.south.uv, [0, 0, 8, 8], 'UV unchanged');

	// Project marked unsaved, canvas refreshed, success shown.
	assert.strictEqual(global.Project.saved, false, 'project marked unsaved');
	assert.ok(canvasLog.view >= 1, 'canvas updateView called');
	assert.ok(canvasLog.bones >= 1, 'canvas updateAllBones called');
	assert.ok(quickMsgs.length === 1 && /Scaled ×0.5/.test(quickMsgs[0]), 'success message: ' + quickMsgs[0]);
	assert.strictEqual(msgBoxes.length, 0, 'no error/abort message box');
});

test('factor 1 is a no-op and creates NO undo entry', function () {
	var proj = buildProject();
	setProject(proj.roots);
	clickAndConfirm({ factor: 1, scope: 'all', pivot: 'origin', scale_animations: false });
	assert.strictEqual(undoLog.init, 0, 'no initEdit');
	assert.strictEqual(undoLog.finish, 0, 'no finishEdit');
	assert.deepStrictEqual(proj.bodyShape.stretch, [1.5, 0.75, 2], 'geometry unchanged');
	assert.ok(quickMsgs.length === 1 && /nothing to change/i.test(quickMsgs[0]), 'no-op message');
});

test('Selected Hierarchy scope only scales the selected subtree', function () {
	var proj = buildProject();
	setProject(proj.roots);
	// Select only the arm bone.
	global.Group.all.forEach(function (g) { g.selected = false; });
	proj.arm.selected = true;
	global.selected = [];

	clickAndConfirm({ factor: 0.5, scope: 'selection', pivot: 'origin', scale_animations: false });

	assert.strictEqual(undoLog.finish, 1, 'one transaction');
	// arm subtree scaled
	assert.deepStrictEqual(proj.arm.origin, [3, 7, 0], 'arm origin halved');
	assert.deepStrictEqual(proj.armShape.stretch, [0.5, 0.5, 0.5], 'arm shape stretch halved');
	// body (not selected) untouched
	assert.deepStrictEqual(proj.root.origin, [0, 12, 0], 'body origin untouched');
	assert.deepStrictEqual(proj.bodyShape.stretch, [1.5, 0.75, 2], 'body stretch untouched');
	// aspects only include the arm subtree (1 group, 1 cube)
	assert.strictEqual(undoLog.lastAspects.elements.length, 1, 'one cube in aspects');
	assert.strictEqual(undoLog.lastAspects.groups.length, 1, 'one group in aspects');
});

test('custom pivot scales around the given point', function () {
	var proj = buildProject();
	setProject(proj.roots);
	clickAndConfirm({ factor: 0.5, scope: 'all', pivot: 'custom', custom_pivot: [0, 16, 0], scale_animations: false });
	// body bone origin [0,12,0] about pivot [0,16,0]: y = 16 + 0.5*(12-16) = 14
	assert.deepStrictEqual(proj.root.origin, [0, 14, 0], 'origin scaled about custom pivot');
	assert.strictEqual(undoLog.finish, 1, 'one transaction');
});

test('scaling loaded position animations: position ×0.5, scale channel untouched', function () {
	var proj = buildProject();
	setProject(proj.roots);
	var posKf = new H.MockKeyframe({ channel: 'position', time: 0.5, interpolation: 'linear', data_points: [{ x: 8, y: -4, z: 2 }] });
	var sclKf = new H.MockKeyframe({ channel: 'scale', time: 0.5, interpolation: 'linear', data_points: [{ x: 1.5, y: 1.5, z: 1.5 }] });
	var animator = new H.MockBoneAnimator({ name: 'body', group: proj.root, position: [posKf], scale: [sclKf] });
	var anim = new H.MockAnimation({ name: 'wiggle', length: 1, loop: 'loop', animators: [animator] });
	anim.saved = true;
	global.Animation = { all: [anim] };

	clickAndConfirm({ factor: 0.5, scope: 'all', pivot: 'origin', scale_animations: true });

	assert.deepStrictEqual([posKf.get('x'), posKf.get('y'), posKf.get('z')], [4, -2, 1], 'position keyframe halved');
	assert.deepStrictEqual([sclKf.get('x'), sclKf.get('y'), sclKf.get('z')], [1.5, 1.5, 1.5], 'scale keyframe untouched');
	assert.strictEqual(posKf.time, 0.5, 'keyframe time preserved');
	assert.strictEqual(anim.saved, false, 'animation marked unsaved');
	assert.ok(undoLog.lastAspects.animations && undoLog.lastAspects.animations.length === 1, 'animations aspect present');
	assert.ok(undoLog.lastAspects.keyframes && undoLog.lastAspects.keyframes.length === 1, 'keyframes aspect present');
	assert.ok(/1 animation/.test(quickMsgs[0]), 'success message mentions animation: ' + quickMsgs[0]);
	global.Animation = { all: [] };
});

test('unsupported element types abort before any edit', function () {
	function MockMesh(name) { this.uuid = 'mesh-' + name; this.name = name; this.children = undefined; this.parent = 'root'; }
	var proj = buildProject();
	var mesh = new MockMesh('blob');
	proj.roots.push(mesh);
	setProject(proj.roots);

	clickAndConfirm({ factor: 0.5, scope: 'all', pivot: 'origin', scale_animations: false });

	assert.strictEqual(undoLog.init, 0, 'no edit started');
	assert.strictEqual(undoLog.finish, 0, 'no edit finished');
	assert.ok(msgBoxes.length === 1 && /unsupported|cannot scale/i.test(msgBoxes[0].message), 'abort message shown');
	assert.deepStrictEqual(proj.bodyShape.stretch, [1.5, 0.75, 2], 'model not modified');
});

test('failure inside the transaction rolls back fully (restore + cancelEdit + error)', function () {
	var proj = buildProject();
	setProject(proj.roots);
	var origStretch = proj.bodyShape.stretch.slice();
	var origOrigin = proj.root.origin.slice();

	// Fault injection: make finishEdit throw to drive the catch/rollback path.
	var realFinish = global.Undo.finishEdit;
	global.Undo.finishEdit = function () { throw new Error('injected failure'); };
	try {
		clickAndConfirm({ factor: 0.5, scope: 'all', pivot: 'origin', scale_animations: false });
	} finally {
		global.Undo.finishEdit = realFinish;
	}

	assert.strictEqual(undoLog.cancel, 1, 'cancelEdit called on failure');
	assert.deepStrictEqual(proj.bodyShape.stretch, origStretch, 'stretch restored');
	assert.deepStrictEqual(proj.root.origin, origOrigin, 'origin restored');
	assert.ok(msgBoxes.some(function (m) { return /failed|restored/i.test(m.message); }), 'error message shown');
});

test('onunload deletes the action and dialog', function () {
	deleted.action = false; deleted.dialog = false;
	// ensure a dialog instance exists to be cleaned up
	toolsActions[0].click();
	registered.opts.onunload();
	assert.strictEqual(deleted.action, true, 'action deleted');
	assert.strictEqual(deleted.dialog, true, 'dialog deleted');
});

/* ----------------------------- results ------------------------------ */

console.log('\n────────────────────────────────────');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) {
	console.log('FAILURES: ' + failures.join(', '));
	process.exit(1);
} else {
	console.log('All simulation tests passed.');
	process.exit(0);
}
