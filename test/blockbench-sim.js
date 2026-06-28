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

// Simulates the Hytale plugin's lazy .blockyanim load: animations appear in the
// project only when a select_mode(animate) event fires, and only once.
var dispatchLog = [];
var hytaleLazyAnim = null;

global.Blockbench = {
	showMessageBox: function (o, cb) { msgBoxes.push(o); if (cb) cb(0); },
	showQuickMessage: function (m) { quickMsgs.push(m); },
	isOlderThan: function () { return false; },
	dispatchEvent: function (event, data) {
		dispatchLog.push({ event: event, mode: data && data.mode && data.mode.id });
		if (event === 'select_mode' && data && data.mode && data.mode.id === 'animate' && hytaleLazyAnim) {
			global.Animation.all.push(hytaleLazyAnim);
			hytaleLazyAnim = null; // one-shot, like the real Hytale listener
		}
	}
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

// Mocks for the bake-pose interception feature.
var nativeBakeCalls = 0;
var modeEditCalls = 0;
var originalBakeClickFn = function () { nativeBakeCalls++; };
global.BarItems = { bake_animation_into_model: { id: 'bake_animation_into_model', click: originalBakeClickFn } };
global.Animator = { animations: [], MolangParser: { parse: function () { return 1; } }, open: false };
global.Modes = { options: { edit: { select: function () { modeEditCalls++; } }, animate: { id: 'animate', select: function () {} } } };

// Minimal but correct THREE quaternion/euler mock (ZYX, matching Blockbench).
global.THREE = (function () {
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function Quaternion(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = (w === undefined ? 1 : w); }
	Quaternion.prototype.setFromEuler = function (e) {
		var c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
		var s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
		this.x = s1 * c2 * c3 - c1 * s2 * s3;
		this.y = c1 * s2 * c3 + s1 * c2 * s3;
		this.z = c1 * c2 * s3 - s1 * s2 * c3;
		this.w = c1 * c2 * c3 + s1 * s2 * s3;
		return this;
	};
	Quaternion.prototype.multiply = function (q) {
		var ax = this.x, ay = this.y, az = this.z, aw = this.w, bx = q.x, by = q.y, bz = q.z, bw = q.w;
		this.x = ax * bw + aw * bx + ay * bz - az * by;
		this.y = ay * bw + aw * by + az * bx - ax * bz;
		this.z = az * bw + aw * bz + ax * by - ay * bx;
		this.w = aw * bw - ax * bx - ay * by - az * bz;
		return this;
	};
	Quaternion.prototype.conjugate = function () { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; };
	Quaternion.prototype.clone = function () { return new Quaternion(this.x, this.y, this.z, this.w); };
	function Euler(x, y, z, order) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.order = order || 'ZYX'; }
	Euler.prototype.setFromQuaternion = function (q, order) {
		var x = q.x, y = q.y, z = q.z, w = q.w;
		var m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w);
		var m21 = 2 * (x * y + z * w), m22 = 1 - 2 * (x * x + z * z);
		var m31 = 2 * (x * z - y * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
		this.y = Math.asin(-clamp(m31, -1, 1));
		if (Math.abs(m31) < 0.9999999) { this.x = Math.atan2(m32, m33); this.z = Math.atan2(m21, m11); }
		else { this.x = 0; this.z = Math.atan2(-m12, m22); }
		this.order = order || 'ZYX';
		return this;
	};
	return { Quaternion: Quaternion, Euler: Euler };
})();

/* --- faithful Hytale rotation interpolation for the bake tests ------- *
 * Blockbench composes a rotation keyframe K with the bone's rest rotation
 * F (its fix_rotation) and interpolate() returns euler(F*K) - F, in degrees,
 * ZYX. The previous mock just echoed the stored keyframe value, which hid the
 * exact bug this feature exists to handle. Model it properly so the sim fails
 * on a wrong re-base. F is read live from the group, so capture (old rest) and
 * the post-bake self-check (new rest) differ just like they do in Blockbench. */
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
function quatFromDeg(deg) {
	return new THREE.Quaternion().setFromEuler(new THREE.Euler(deg[0] * D2R, deg[1] * D2R, deg[2] * D2R, 'ZYX'));
}
function eulerDegFromQuat(q) {
	var e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
	return [e.x * R2D, e.y * R2D, e.z * R2D];
}
function bakeInterpRotation(group, K) {
	var fk = eulerDegFromQuat(quatFromDeg(group.rotation).multiply(K));
	return [fk[0] - group.rotation[0], fk[1] - group.rotation[1], fk[2] - group.rotation[2]];
}

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

	// Explicit Model Origin pivot: the subtree scales around [0,0,0], so it moves.
	// Switch scope first (which auto-suggests the root pivot), then override to origin.
	resetLogs();
	toolsActions[0].click();
	lastDialog.setFormValues({ scope: 'all', pivot: 'origin' });    // known baseline
	lastDialog.setFormValues({ scope: 'selection' });               // auto-suggests root
	lastDialog.setFormValues({ pivot: 'origin', factor: 0.5 });     // override back to world origin
	lastDialog.confirm();

	assert.strictEqual(undoLog.finish, 1, 'one transaction');
	// arm subtree scaled (and moved, because the pivot is the world origin)
	assert.deepStrictEqual(proj.arm.origin, [3, 7, 0], 'arm origin halved');
	assert.deepStrictEqual(proj.armShape.stretch, [0.5, 0.5, 0.5], 'arm shape stretch halved');
	// body (not selected) untouched
	assert.deepStrictEqual(proj.root.origin, [0, 12, 0], 'body origin untouched');
	assert.deepStrictEqual(proj.bodyShape.stretch, [1.5, 0.75, 2], 'body stretch untouched');
	// aspects only include the arm subtree (1 group, 1 cube)
	assert.strictEqual(undoLog.lastAspects.elements.length, 1, 'one cube in aspects');
	assert.strictEqual(undoLog.lastAspects.groups.length, 1, 'one group in aspects');
});

test('Selected Hierarchy auto-defaults the pivot to the selected root (scales in place)', function () {
	var proj = buildProject();
	setProject(proj.roots);
	global.Group.all.forEach(function (g) { g.selected = false; });
	proj.arm.selected = true;            // select only the arm bone
	global.selected = [];

	resetLogs();
	toolsActions[0].click();                                 // open the dialog
	lastDialog.setFormValues({ scope: 'all', pivot: 'origin' }); // known starting state

	// Switching to the sub-selection steers the pivot to the selected root...
	lastDialog.setFormValues({ scope: 'selection' });
	assert.strictEqual(lastDialog.getFormResult().pivot, 'root', 'selection -> Selected Root');
	// ...and switching back to the whole model returns to Model Origin.
	lastDialog.setFormValues({ scope: 'all' });
	assert.strictEqual(lastDialog.getFormResult().pivot, 'origin', 'all -> Model Origin');
	// A custom pivot is never overridden by the scope switch.
	lastDialog.setFormValues({ pivot: 'custom' });
	lastDialog.setFormValues({ scope: 'selection' });
	assert.strictEqual(lastDialog.getFormResult().pivot, 'custom', 'custom pivot preserved');

	// With the in-place default, the selected root stays put and its content scales.
	lastDialog.setFormValues({ pivot: 'root', factor: 0.5 });
	lastDialog.confirm();
	assert.strictEqual(undoLog.finish, 1, 'one transaction');
	assert.deepStrictEqual(proj.arm.origin, [6, 14, 0], 'arm root origin unchanged (scaled in place)');
	assert.deepStrictEqual(proj.armShape.stretch, [0.5, 0.5, 0.5], 'arm cube stretch halved');
	assert.deepStrictEqual(proj.root.origin, [0, 12, 0], 'body untouched');
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

test('fresh model in edit mode: opening the dialog lazy-loads the animations so they can be scaled', function () {
	var proj = buildProject();
	setProject(proj.roots);
	global.Format = { id: 'hytale_character' };
	global.Animation = { all: [] };          // fresh load: nothing materialised yet
	global.Animator.open = false;            // still in edit mode
	global.Project = { saved: true };        // a freshly loaded project

	// A position-animated body bone that only appears once select_mode(animate) fires.
	var posKf = new H.MockKeyframe({ channel: 'position', time: 0.25, data_points: [{ x: 8, y: 0, z: 0 }] });
	var an = new H.MockBoneAnimator({ name: 'body', uuid: proj.root.uuid, group: proj.root, position: [posKf] });
	var walk = new H.MockAnimation({ name: 'walk', length: 1, loop: 'loop', animators: [an] });
	walk.saved = true;
	hytaleLazyAnim = walk;
	dispatchLog.length = 0;
	resetLogs();

	toolsActions[0].click();                 // opening the dialog should trigger the load
	assert.ok(dispatchLog.some(function (d) { return d.event === 'select_mode' && d.mode === 'animate'; }), 'fires select_mode(animate) to trigger the lazy load');
	assert.strictEqual(global.Animation.all.length, 1, 'animation is now loaded into the project');
	assert.strictEqual(lastDialog.getFormResult().scale_animations, true, 'scale-animations checkbox defaults on now that an animation is present');

	lastDialog.setFormValues({ factor: 0.5, scale_animations: true });
	lastDialog.confirm();
	assert.deepStrictEqual([posKf.get('x'), posKf.get('y'), posKf.get('z')], [4, 0, 0], 'the lazy-loaded position keyframe is scaled');
	global.Animation = { all: [] };
});

test('the animation pre-load fires at most once per project', function () {
	setProject(buildProject().roots);
	global.Format = { id: 'hytale_character' };
	global.Animation = { all: [] };
	global.Animator.open = false;
	global.Project = { saved: true };        // fresh project, no animations to find
	hytaleLazyAnim = null;                    // nothing will load
	dispatchLog.length = 0;

	toolsActions[0].click();
	assert.strictEqual(dispatchLog.filter(function (d) { return d.event === 'select_mode'; }).length, 1, 'fires once on the first open');
	toolsActions[0].click();
	assert.strictEqual(dispatchLog.filter(function (d) { return d.event === 'select_mode'; }).length, 1, 'does not fire again for the same project');
	global.Animation = { all: [] };
});

test('no spurious select_mode dispatch when animations are already loaded', function () {
	var proj = buildProject();
	setProject(proj.roots);
	global.Format = { id: 'hytale_character' };
	var posKf = new H.MockKeyframe({ channel: 'position', time: 0.25, data_points: [{ x: 8, y: 0, z: 0 }] });
	var an = new H.MockBoneAnimator({ name: 'body', uuid: proj.root.uuid, group: proj.root, position: [posKf] });
	global.Animation = { all: [new H.MockAnimation({ name: 'walk', length: 1, loop: 'loop', animators: [an] })] };
	global.Animator.open = false;
	hytaleLazyAnim = null;
	dispatchLog.length = 0;

	toolsActions[0].click();
	assert.ok(!dispatchLog.some(function (d) { return d.event === 'select_mode'; }), 'does not fire select_mode when animations are already present');
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

/* ----------------------------- bake-pose interception ------------------ */

function buildBakeAnim(group, rotVals, posVals, extraRotKfs) {
	var rotKf = new H.MockKeyframe({ channel: 'rotation', time: 0.25, data_points: [{ x: rotVals[0], y: rotVals[1], z: rotVals[2] }] });
	var posKf = new H.MockKeyframe({ channel: 'position', time: 0.25, data_points: [{ x: posVals[0], y: posVals[1], z: posVals[2] }] });
	var rotList = [rotKf].concat(extraRotKfs || []);
	var an = new H.MockBoneAnimator({ name: group.name, uuid: group.uuid, group: group, rotation: rotList, position: [posKf] });
	an.channels = { rotation: true, position: true };
	// The timeline cursor sits on rotKf (the bake frame); interpolate() models the
	// real euler(F*K) - F so capture and the self-check see the rest pose live.
	an.interpolate = function (channel) {
		if (channel === 'rotation') {
			return bakeInterpRotation(group, quatFromDeg([Number(rotKf.get('x')), Number(rotKf.get('y')), Number(rotKf.get('z'))]));
		}
		if (channel === 'position') return [Number(posKf.get('x')), Number(posKf.get('y')), Number(posKf.get('z'))];
		return false;
	};
	var anim = new H.MockAnimation({ name: 'bakeanim', length: 1, loop: 'loop', animators: [an] });
	anim.playing = true;
	anim.getBoneAnimator = function (g) { return g === group ? an : null; };
	return { anim: anim, an: an, rotKf: rotKf, posKf: posKf, rotList: rotList };
}

test('native bake action is intercepted (wrapped) after load', function () {
	assert.notStrictEqual(global.BarItems.bake_animation_into_model.click, originalBakeClickFn, 'click is wrapped by the plugin');
});

test('intercepted bake + re-base: one undo, rest pose baked, animations shifted', function () {
	var proj = buildProject(); setProject(proj.roots);
	global.Format = { id: 'hytale_character' };
	var b = buildBakeAnim(proj.root, [10, 0, 0], [0, 6, 0]);
	global.Animation = { all: [b.anim] };
	global.Animator.animations = [b.anim];
	var rotBefore = proj.root.rotation.slice();
	var originBefore = proj.root.origin.slice();
	resetLogs(); nativeBakeCalls = 0; modeEditCalls = 0;

	global.BarItems.bake_animation_into_model.click();      // intercepted -> popup
	assert.ok(lastDialog, 'bake dialog opened');
	lastDialog.confirm();                                   // re-base default true

	assert.strictEqual(nativeBakeCalls, 0, 'native bake not called in the combined path');
	assert.strictEqual(undoLog.init, 1, 'initEdit once');
	assert.strictEqual(undoLog.finish, 1, 'finishEdit once');
	assert.strictEqual(undoLog.cancel, 0, 'no rollback');
	assert.ok(/re-based/.test(undoLog.lastLabel), 'undo label mentions re-based');
	assert.ok(P.vecNearlyEqual(proj.root.rotation, [rotBefore[0] + 10, rotBefore[1], rotBefore[2]], 1e-6), 'bone rotation baked (native euler add)');
	assert.deepStrictEqual(proj.root.origin, [originBefore[0], originBefore[1] + 6, originBefore[2]], 'bone origin baked');
	assert.ok(P.vecNearlyEqual([b.rotKf.get('x'), b.rotKf.get('y'), b.rotKf.get('z')], [0, 0, 0], 1e-6), 'rotation keyframe re-based to ~0');
	assert.deepStrictEqual([b.posKf.get('x'), b.posKf.get('y'), b.posKf.get('z')], [0, 0, 0], 'position keyframe re-based to 0');
	assert.strictEqual(b.anim.saved, false, 'animation marked unsaved');
	assert.strictEqual(global.Project.saved, false, 'project marked unsaved');
	assert.ok(modeEditCalls >= 1, 'switched to edit mode (matches native)');
	assert.ok(quickMsgs.some(function (m) { return /re-based/.test(m); }), 'success message shown');
});

test('quaternion rotation re-base: multi-axis pose + non-zero rest passes the self-check (no rollback)', function () {
	var proj = buildProject(); setProject(proj.roots);
	global.Format = { id: 'hytale_character' };
	proj.root.rotation = [5, 10, 0];                 // non-zero rest rotation
	var b = buildBakeAnim(proj.root, [10, 20, 30], [0, 0, 0]); // combined multi-axis pose
	global.Animation = { all: [b.anim] }; global.Animator.animations = [b.anim];
	resetLogs(); nativeBakeCalls = 0;

	global.BarItems.bake_animation_into_model.click();
	lastDialog.confirm();

	assert.strictEqual(undoLog.finish, 1, 'committed');
	assert.strictEqual(undoLog.cancel, 0, 'no rollback — rotation self-check passed (euler subtraction would have failed here)');
	assert.ok(P.vecNearlyEqual([b.rotKf.get('x'), b.rotKf.get('y'), b.rotKf.get('z')], [0, 0, 0], 1e-6), 'rotation keyframe collapses at the baked frame');
	assert.ok(!P.vecNearlyEqual(proj.root.rotation, [5, 10, 0], 1e-6), 'rest rotation changed by the bake');
});

test('rotation re-base keeps every keyframe pose against the new rest (end-to-end)', function () {
	var proj = buildProject(); setProject(proj.roots);
	global.Format = { id: 'hytale_character' };
	proj.root.rotation = [8, -12, 4];                                  // non-zero rest
	var restBefore = proj.root.rotation.slice();
	var kfB_raw = [-15, 25, 5];                                        // a second, non-cursor keyframe
	var kfB = new H.MockKeyframe({ channel: 'rotation', time: 0.5, data_points: [{ x: kfB_raw[0], y: kfB_raw[1], z: kfB_raw[2] }] });
	var b = buildBakeAnim(proj.root, [10, 20, 30], [0, 0, 0], [kfB]);  // cursor pose = [10,20,30]
	global.Animation = { all: [b.anim] }; global.Animator.animations = [b.anim];

	// World orientation at kfB before the bake (rest * key), for the invariance check.
	var worldBefore = eulerDegFromQuat(quatFromDeg(restBefore).multiply(quatFromDeg(kfB_raw)));
	// Independently derive the expected re-based kfB (= K0^-1 * K_B) from the plugin's own math.
	var off = b.an.interpolate('rotation');
	var qFnew = quatFromDeg([restBefore[0] + off[0], restBefore[1] + off[1], restBefore[2] + off[2]]);
	var K0inv = quatFromDeg(restBefore).conjugate().multiply(qFnew).conjugate();
	var expectedB = eulerDegFromQuat(K0inv.clone().multiply(quatFromDeg(kfB_raw)));

	resetLogs(); nativeBakeCalls = 0;
	global.BarItems.bake_animation_into_model.click();
	lastDialog.confirm();

	assert.strictEqual(undoLog.finish, 1, 'committed, no rollback');
	assert.strictEqual(undoLog.cancel, 0, 'self-check passed');
	assert.ok(P.vecNearlyEqual([b.rotKf.get('x'), b.rotKf.get('y'), b.rotKf.get('z')], [0, 0, 0], 1e-6), 'bake-frame key collapses to ~0');
	assert.ok(P.vecNearlyEqual([kfB.get('x'), kfB.get('y'), kfB.get('z')], expectedB, 1e-6), 'second key re-based to K0^-1 * K');
	// The decisive end-to-end property: new rest * re-based key == old rest * old key.
	var worldAfter = eulerDegFromQuat(quatFromDeg(proj.root.rotation).multiply(quatFromDeg([kfB.get('x'), kfB.get('y'), kfB.get('z')])));
	assert.ok(P.vecNearlyEqual(worldBefore, worldAfter, 1e-6), 'world orientation at kfB unchanged by the bake');
});

test('intercepted bake with re-base OFF performs the plain native bake', function () {
	var proj = buildProject(); setProject(proj.roots);
	global.Format = { id: 'hytale_character' };
	var b = buildBakeAnim(proj.root, [10, 0, 0], [0, 6, 0]);
	global.Animation = { all: [b.anim] }; global.Animator.animations = [b.anim];
	resetLogs(); nativeBakeCalls = 0;

	global.BarItems.bake_animation_into_model.click();
	lastDialog.setFormValues({ rebase: false });
	lastDialog.confirm();

	assert.strictEqual(nativeBakeCalls, 1, 'native bake called');
	assert.strictEqual(undoLog.init, 0, 'no plugin transaction');
	assert.deepStrictEqual([b.rotKf.get('x'), b.rotKf.get('y'), b.rotKf.get('z')], [10, 0, 0], 'keyframes untouched');
});

test('native bake passes through unchanged for non-Hytale formats (no popup)', function () {
	global.Format = { id: 'java_block' };
	resetLogs(); nativeBakeCalls = 0; lastDialog = null;
	global.BarItems.bake_animation_into_model.click();
	assert.strictEqual(nativeBakeCalls, 1, 'native called directly');
	assert.strictEqual(lastDialog, null, 'no popup for non-Hytale');
	assert.strictEqual(undoLog.init, 0, 'no plugin transaction');
	global.Format = { id: 'hytale_character' };
});

test('onunload deletes the action and dialog, and restores the native bake', function () {
	deleted.action = false; deleted.dialog = false;
	// ensure a dialog instance exists to be cleaned up
	toolsActions[0].click();
	registered.opts.onunload();
	assert.strictEqual(deleted.action, true, 'action deleted');
	assert.strictEqual(deleted.dialog, true, 'dialog deleted');
	assert.strictEqual(global.BarItems.bake_animation_into_model.click, originalBakeClickFn, 'native bake click restored');
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
