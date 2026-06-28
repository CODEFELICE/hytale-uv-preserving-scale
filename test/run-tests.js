/*
 * Test suite for Hytale UV-Preserving Scale.
 *
 * Run with:  node test/run-tests.js
 *
 * Covers the 16 required unit tests plus an end-to-end integration acceptance
 * test that exports a representative model (and animation) to .blockymodel /
 * .blockyanim JSON before and after scaling and recursively compares them,
 * using a port of the official Hytale exporter (see test/harness.js).
 */

'use strict';

var assert = require('assert');
var H = require('./harness.js');
var P = H.PURE;

/* ----------------------------- tiny test runner --------------------- */

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
	try {
		fn();
		passed++;
		console.log('  ✓ ' + name);
	} catch (err) {
		failed++;
		failures.push({ name: name, err: err });
		console.log('  ✗ ' + name);
		console.log('      ' + (err && err.message ? err.message : err));
	}
}

function section(title) {
	console.log('\n' + title);
}

// Approximate vector equality assertion.
function assertVecClose(actual, expected, msg) {
	assert.ok(P.vecNearlyEqual(actual, expected),
		(msg || 'vectors differ') + '\n        expected [' + expected + ']\n        actual   [' + actual + ']');
}

/* =================================================================== *
 *  1. Factor 0.5 around [0,0,0]                                        *
 * =================================================================== */

section('Pure transform tests');

test('1. factor 0.5 around [0,0,0] scales center, origin and stretch, preserves size', function () {
	var res = P.transformCubeData(
		{ from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], stretch: [1, 1, 1] },
		[0, 0, 0], 0.5
	);
	assertVecClose(res.from, [-1, -1, -1], 'from');
	assertVecClose(res.to, [3, 3, 3], 'to');
	assertVecClose(P.centerOf(res.from, res.to), [1, 1, 1], 'center halved');
	assertVecClose(res.origin, [1, 1, 1], 'origin halved');
	assertVecClose(res.stretch, [0.5, 0.5, 0.5], 'stretch halved');
	// base size unchanged
	assertVecClose([res.to[0] - res.from[0], res.to[1] - res.from[1], res.to[2] - res.from[2]], [4, 4, 4], 'size preserved');
});

/* 2. Factor 2 around [0,0,0] */
test('2. factor 2 around [0,0,0] doubles center/origin/stretch, preserves size', function () {
	var res = P.transformCubeData(
		{ from: [1, 1, 1], to: [3, 3, 3], origin: [2, 2, 2], stretch: [1, 1, 1] },
		[0, 0, 0], 2
	);
	assertVecClose(P.centerOf(res.from, res.to), [4, 4, 4], 'center doubled');
	assertVecClose(res.origin, [4, 4, 4], 'origin doubled');
	assertVecClose(res.stretch, [2, 2, 2], 'stretch doubled');
	assertVecClose([res.to[0] - res.from[0], res.to[1] - res.from[1], res.to[2] - res.from[2]], [2, 2, 2], 'size preserved');
});

/* 3. Scaling around a non-zero custom pivot */
test('3. scaling around a non-zero custom pivot', function () {
	var pivot = [10, 0, -4];
	var res = P.transformCubeData(
		{ from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], stretch: [1, 1, 1] },
		pivot, 0.5
	);
	// center [2,2,2] -> P + 0.5*(C-P)
	var expCenter = P.scalePointAroundPivot([2, 2, 2], pivot, 0.5);
	assertVecClose(P.centerOf(res.from, res.to), expCenter, 'center about pivot');
	assertVecClose(res.origin, P.scalePointAroundPivot([2, 2, 2], pivot, 0.5), 'origin about pivot');
	// size preserved regardless of pivot
	assertVecClose([res.to[0] - res.from[0], res.to[1] - res.from[1], res.to[2] - res.from[2]], [4, 4, 4], 'size preserved');
	// a point on the pivot does not move
	assertVecClose(P.scalePointAroundPivot(pivot, pivot, 0.5), pivot, 'pivot is a fixed point');
});

/* 4. Existing non-uniform stretch (spec example) */
test('4. existing non-uniform stretch [1.5,0.75,2] × 0.5 = [0.75,0.375,1]', function () {
	assertVecClose(P.scaleStretch([1.5, 0.75, 2], 0.5), [0.75, 0.375, 1], 'stretch multiplied componentwise');
	// And multiplied, never reset:
	assertVecClose(P.scaleStretch([3, 3, 3], 2), [6, 6, 6], 'stretch multiplied not reset');
});

/* 5. Negative coordinates */
test('5. negative coordinates scale correctly with no negative zero', function () {
	var res = P.transformCubeData(
		{ from: [-4, -4, -4], to: [-2, -2, -2], origin: [-3, -3, -3], stretch: [1, 1, 1] },
		[0, 0, 0], 0.5
	);
	assertVecClose(res.from, [-2.5, -2.5, -2.5], 'from');
	assertVecClose(res.to, [-0.5, -0.5, -0.5], 'to');
	assertVecClose(res.origin, [-1.5, -1.5, -1.5], 'origin');
	// negative zero normalization
	assert.ok(Object.is(P.normalizeZero(-0), 0), '-0 normalized to 0');
	var z = P.scalePointAroundPivot([0, 0, 0], [0, 0, 0], 0.5);
	assert.ok(Object.is(z[0], 0) && Object.is(z[1], 0) && Object.is(z[2], 0), 'no -0 in result');
});

/* 6. Deeply nested group positions (world-space origins each scale by s) */
test('6. deeply nested group origins each scale by s', function () {
	var root = new H.MockGroup({ name: 'root', origin: [0, 0, 0] });
	var mid = new H.MockGroup({ name: 'mid', origin: [10, 0, 0] });
	var leaf = new H.MockGroup({ name: 'leaf', origin: [10, 20, 0] });
	root.add(mid); mid.add(leaf);
	H.applyScaleToMockTree([root], [0, 0, 0], 0.5);
	assertVecClose(root.origin, [0, 0, 0], 'root');
	assertVecClose(mid.origin, [5, 0, 0], 'mid');
	assertVecClose(leaf.origin, [5, 10, 0], 'leaf');
});

/* 7. Rotated groups keep their rotation unchanged */
test('7. rotated groups: rotation unchanged, origin scaled', function () {
	var g = new H.MockGroup({ name: 'arm', origin: [8, 8, 8], rotation: [30, 45, -60] });
	var before = g.rotation.slice();
	P.applyGroupTransform(g, [0, 0, 0], 0.5);
	assert.deepStrictEqual(g.rotation, before, 'rotation must be byte-identical');
	assertVecClose(g.origin, [4, 4, 4], 'origin scaled');
});

/* 8. Standalone rotated cubes */
test('8. standalone rotated cube: rotation unchanged; origin & center scale', function () {
	var c = new H.MockCube({
		name: 'rot', from: [0, 0, 0], to: [2, 6, 2], origin: [0, 0, 0],
		rotation: [15, 0, 90], stretch: [1, 1, 1]
	});
	var rotBefore = c.rotation.slice();
	var centerBefore = P.centerOf(c.from, c.to);
	P.applyCubeTransform(c, [0, 0, 0], 0.5);
	assert.deepStrictEqual(c.rotation, rotBefore, 'rotation unchanged');
	assertVecClose([c.to[0] - c.from[0], c.to[1] - c.from[1], c.to[2] - c.from[2]], [2, 6, 2], 'size preserved');
	assertVecClose(P.centerOf(c.from, c.to), P.scalePointAroundPivot(centerBefore, [0, 0, 0], 0.5), 'center scaled');
	assertVecClose(c.origin, [0, 0, 0], 'origin scaled');
});

/* 9. Hytale quads with a zero-sized axis */
test('9. quad with zero-sized axis: size axis stays 0; stretch scales; zero/negative stretch preserved', function () {
	var faces = H.defaultFaces();
	faces.south.texture = 'tex'; // +Z quad
	faces.south.uv = [0, 0, 8, 8];
	var quad = new H.MockCube({ name: 'quad', from: [0, 0, 0], to: [8, 8, 0], origin: [4, 4, 0], stretch: [1, 1, 1], faces: faces });
	P.applyCubeTransform(quad, [0, 0, 0], 0.5);
	// The quad's zero AXIS is its base SIZE on Z — it must stay exactly 0.
	assert.strictEqual(quad.to[2] - quad.from[2], 0, 'z size axis stays 0');
	assertVecClose(quad.stretch, [0.5, 0.5, 0.5], 'stretch multiplied componentwise');
	// Zero and negative stretch components are preserved (and -0 is normalized).
	var sc = P.scaleStretch([3, -2, 0], 0.5);
	assert.deepStrictEqual(sc, [1.5, -1, 0], 'zero & negative stretch preserved');
	assert.ok(Object.is(sc[2], 0), 'no negative zero on a zero stretch axis');
});

/* 10. Empty groups using stored offsets */
test('10. empty group: original_offset and origin both scale by s', function () {
	var g = new H.MockGroup({ name: 'empty', origin: [4, 4, 4], original_offset: [3, 5, 7], original_position: [2, -2, 2] });
	P.applyGroupTransform(g, [0, 0, 0], 0.5);
	assertVecClose(g.origin, [2, 2, 2], 'origin scaled');
	assertVecClose(g.original_offset, [1.5, 2.5, 3.5], 'original_offset multiplied by s');
	assertVecClose(g.original_position, [1, -1, 1], 'original_position multiplied by s');
});

/* 11. Mirrored and rotated UV faces remain untouched */
test('11. mirrored & rotated UV faces are left completely unchanged', function () {
	var faces = H.defaultFaces();
	faces.south.texture = 'tex';
	faces.south.uv = [10, 2, 4, 8];   // mirrored on X (uv[0] > uv[2])
	faces.south.rotation = 90;
	faces.east.texture = 'tex';
	faces.east.uv = [0, 9, 6, 3];     // mirrored on Y (uv[1] > uv[3])
	faces.east.rotation = 270;
	var c = new H.MockCube({ name: 'uvbox', from: [0, 0, 0], to: [6, 6, 6], origin: [3, 3, 3], faces: faces });

	var snap = P.snapshotModelState([c], [], []);
	P.applyCubeTransform(c, [0, 0, 0], 0.5);
	assert.deepStrictEqual(c.faces.south.uv, [10, 2, 4, 8], 'mirrored uv unchanged');
	assert.strictEqual(c.faces.south.rotation, 90, 'uv rotation unchanged');
	assert.deepStrictEqual(c.faces.east.uv, [0, 9, 6, 3], 'mirrored-Y uv unchanged');
	assert.strictEqual(c.faces.east.rotation, 270, 'uv rotation unchanged');
	var v = P.validateTransformedState(snap, 0.5, [0, 0, 0], false);
	assert.ok(v.ok, 'validation passes: ' + v.error);
});

/* 12. Position animation keyframes */
section('Animation tests');

test('12. position keyframes are multiplied by s; time/interpolation preserved', function () {
	var kf1 = new H.MockKeyframe({ channel: 'position', time: 0.5, interpolation: 'catmullrom', data_points: [{ x: 4, y: -8, z: 2 }] });
	var kf2 = new H.MockKeyframe({ channel: 'position', time: 1.25, interpolation: 'linear', data_points: [{ x: 0, y: 10, z: -6 }] });
	P.scaleLoadedPositionAnimations([kf1, kf2], 0.5);
	assert.strictEqual(kf1.get('x'), 2); assert.strictEqual(kf1.get('y'), -4); assert.strictEqual(kf1.get('z'), 1);
	assert.strictEqual(kf2.get('y'), 5); assert.strictEqual(kf2.get('z'), -3);
	assert.strictEqual(kf1.time, 0.5, 'time preserved');
	assert.strictEqual(kf1.interpolation, 'catmullrom', 'interpolation preserved');
	assert.strictEqual(kf2.interpolation, 'linear', 'interpolation preserved');
	// String / expression handling:
	assert.strictEqual(P.scaleKeyframeValue('8', 0.5), 4, 'numeric string scaled to number');
	assert.strictEqual(P.scaleKeyframeValue('math.sin(q.life)', 0.5), '(math.sin(q.life)) * 0.5', 'expression wrapped');
});

/* 13. Shape-stretch (scale) animation keyframes remain unchanged */
test('13. scale/shapeStretch keyframes are NOT touched by position scaling', function () {
	var scaleKf = new H.MockKeyframe({ channel: 'scale', time: 0.5, data_points: [{ x: 1.5, y: 1.5, z: 1.5 }] });
	var posKf = new H.MockKeyframe({ channel: 'position', time: 0.5, data_points: [{ x: 4, y: 4, z: 4 }] });
	// Only position keyframes are passed to the scaler (mirrors the live code).
	P.scaleLoadedPositionAnimations([posKf], 0.5);
	assert.deepStrictEqual([scaleKf.get('x'), scaleKf.get('y'), scaleKf.get('z')], [1.5, 1.5, 1.5], 'shapeStretch keyframe unchanged');
	assert.deepStrictEqual([posKf.get('x'), posKf.get('y'), posKf.get('z')], [2, 2, 2], 'position keyframe scaled');
});

test('13b. rebaseKeyframeValue subtracts the baked offset (numbers, numeric strings, expressions, no-op)', function () {
	assert.strictEqual(P.rebaseKeyframeValue(9, 4), 5, 'number minus offset');
	assert.strictEqual(P.rebaseKeyframeValue(-12, -12), 0, 'collapses to 0 at the baked frame');
	assert.ok(Object.is(P.rebaseKeyframeValue(-12, -12), 0), 'no negative zero');
	assert.strictEqual(P.rebaseKeyframeValue('8', 0.5), 7.5, 'numeric string');
	assert.strictEqual(P.rebaseKeyframeValue(3, 0), 3, 'offset 0 is a no-op');
	assert.strictEqual(P.rebaseKeyframeValue('math.sin(q.life)', 2), '(math.sin(q.life)) - (2)', 'expression wrapped');
});

/* 14. Repeated application of scaling */
section('Robustness tests');

test('14. repeated scaling composes (0.5 then 0.5 == 0.25; 0.5 then 2 == identity)', function () {
	var c = new H.MockCube({ from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], stretch: [1, 1, 1] });
	P.applyCubeTransform(c, [0, 0, 0], 0.5);
	P.applyCubeTransform(c, [0, 0, 0], 0.5);
	assertVecClose(c.stretch, [0.25, 0.25, 0.25], 'stretch composes to 0.25');
	assertVecClose(P.centerOf(c.from, c.to), [0.5, 0.5, 0.5], 'center composes');
	assertVecClose([c.to[0] - c.from[0], c.to[1] - c.from[1], c.to[2] - c.from[2]], [4, 4, 4], 'size still preserved');

	var c2 = new H.MockCube({ from: [1, 2, 3], to: [5, 8, 9], origin: [3, 5, 6], stretch: [2, 0.5, 1] });
	var f0 = c2.from.slice(), t0 = c2.to.slice(), o0 = c2.origin.slice(), s0 = c2.stretch.slice();
	P.applyCubeTransform(c2, [7, 7, 7], 0.5);
	P.applyCubeTransform(c2, [7, 7, 7], 2);
	assertVecClose(c2.from, f0, 'from round-trips'); assertVecClose(c2.to, t0, 'to round-trips');
	assertVecClose(c2.origin, o0, 'origin round-trips'); assertVecClose(c2.stretch, s0, 'stretch round-trips');
});

/* 15. Invalid numeric input */
test('15. invalid scale factors are rejected; valid ones accepted', function () {
	var bad = [NaN, Infinity, -Infinity, 0, -1, -0.5, 0.05, 11, '', null, undefined, 'abc'];
	bad.forEach(function (v) {
		assert.strictEqual(P.validateScaleFactor(v).ok, false, 'should reject: ' + String(v));
	});
	assert.strictEqual(P.validateScaleFactor(0.5).ok, true, 'accept 0.5');
	assert.strictEqual(P.validateScaleFactor(1).ok, true, 'accept 1');
	assert.strictEqual(P.validateScaleFactor(10).ok, true, 'accept 10');
	assert.strictEqual(P.validateScaleFactor(0.1).ok, true, 'accept 0.1');
	assert.strictEqual(P.validateScaleFactor('2.5').value, 2.5, 'parse numeric string');
});

/* 16. Rollback after a forced validation failure */
test('16. forced validation failure is detected and snapshot fully restores state', function () {
	var g = new H.MockGroup({ name: 'g', origin: [6, 6, 6], original_offset: [2, 2, 2] });
	var faces = H.defaultFaces(); faces.south.texture = 'tex'; faces.south.uv = [0, 0, 4, 4];
	var c = new H.MockCube({ name: 'c', from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], stretch: [1.5, 1, 2], faces: faces });
	g.add(c);

	// Deep copy of original raw state for final comparison.
	var orig = {
		gOrigin: g.origin.slice(), gOffset: g.original_offset.slice(),
		cFrom: c.from.slice(), cTo: c.to.slice(), cOrigin: c.origin.slice(),
		cStretch: c.stretch.slice(), cUv: c.faces.south.uv.slice()
	};

	var snapshot = P.snapshotModelState([c], [g], []);
	P.applyGroupTransform(g, [0, 0, 0], 0.5);
	P.applyCubeTransform(c, [0, 0, 0], 0.5);

	// Force a corruption that a real failure could cause, then validate.
	c.from[0] = 999;
	var v = P.validateTransformedState(snapshot, 0.5, [0, 0, 0], false);
	assert.strictEqual(v.ok, false, 'validation must catch the corruption');

	// Roll back from the snapshot.
	P.restoreSnapshot(snapshot);
	assert.deepStrictEqual(g.origin, orig.gOrigin, 'group origin restored');
	assert.deepStrictEqual(g.original_offset, orig.gOffset, 'group offset restored');
	assert.deepStrictEqual(c.from, orig.cFrom, 'cube from restored');
	assert.deepStrictEqual(c.to, orig.cTo, 'cube to restored');
	assert.deepStrictEqual(c.origin, orig.cOrigin, 'cube origin restored');
	assert.deepStrictEqual(c.stretch, orig.cStretch, 'cube stretch restored');
	assert.deepStrictEqual(c.faces.south.uv, orig.cUv, 'cube uv restored');
});

/* =================================================================== *
 *  Integration acceptance test                                        *
 * =================================================================== */

section('Integration acceptance test (export equivalence)');

// Build a representative model (nested groups, rotations, boxes, a quad,
// non-default stretch, mirrored UVs, rotated UVs, an empty hierarchy node).
function buildRepresentativeModel() {
	// Root bone with a main shape (a box). Its main shape qualifies (rotation 0).
	var root = new H.MockGroup({ name: 'body', origin: [0, 12, 0] });
	var bodyShape = new H.MockCube({
		name: 'body', from: [-4, 8, -2], to: [4, 16, 2], origin: [0, 12, 0],
		stretch: [1.5, 0.75, 2], shading_mode: 'standard', double_sided: false
	});
	// give body some textured, mirrored / rotated faces
	bodyShape.faces.south.texture = 'tex'; bodyShape.faces.south.uv = [8, 0, 0, 8]; bodyShape.faces.south.rotation = 0; // mirrored X
	bodyShape.faces.north.texture = 'tex'; bodyShape.faces.north.uv = [0, 0, 8, 8]; bodyShape.faces.north.rotation = 90; // rotated
	bodyShape.faces.up.texture = 'tex'; bodyShape.faces.up.uv = [0, 8, 8, 0]; bodyShape.faces.up.rotation = 0; // mirrored Y
	root.add(bodyShape);

	// Nested rotated child bone with its own shape and a non-uniform stretch.
	var arm = new H.MockGroup({ name: 'arm', origin: [5, 14, 0], rotation: [0, 0, -35] });
	var armShape = new H.MockCube({
		name: 'arm', from: [4, 6, -1.5], to: [7, 14, 1.5], origin: [5, 14, 0], stretch: [1, 2, 1]
	});
	armShape.faces.east.texture = 'tex'; armShape.faces.east.uv = [0, 0, 3, 8];
	arm.add(armShape);
	root.add(arm);

	// A standalone rotated decorative cube inside arm (not a main shape).
	var deco = new H.MockCube({
		name: 'deco', from: [6, 13, -0.5], to: [8, 15, 0.5], origin: [7, 14, 0], rotation: [20, 0, 0], stretch: [1, 1, 1]
	});
	deco.faces.south.texture = 'tex'; deco.faces.south.uv = [0, 0, 2, 2];
	arm.add(deco);

	// A quad (zero-size Z), single textured face, as a child bone shape.
	var flag = new H.MockGroup({ name: 'flag', origin: [0, 20, 4] });
	var quad = new H.MockCube({ name: 'flag', from: [-3, 18, 4], to: [3, 24, 4], origin: [0, 21, 4], stretch: [1, 1, 1] });
	quad.faces.south.texture = 'tex'; quad.faces.south.uv = [0, 0, 6, 6]; quad.faces.south.rotation = 180;
	flag.add(quad);
	root.add(flag);

	// An empty hierarchy node (no shape) that carries a stored original_offset.
	var attach = new H.MockGroup({ name: 'attach_point', origin: [0, 16, 0], original_offset: [0, 4, -3], is_piece: true });
	root.add(attach);

	return [root];
}

function buildRepresentativeAnimation(rootNodes) {
	// Position + rotation + shapeStretch(scale) + visibility + uv_offset channels.
	var posKfs = [
		new H.MockKeyframe({ channel: 'position', time: 0, interpolation: 'linear', data_points: [{ x: 0, y: 0, z: 0 }] }),
		new H.MockKeyframe({ channel: 'position', time: 0.5, interpolation: 'catmullrom', data_points: [{ x: 6, y: -10, z: 4 }] })
	];
	var rotKfs = [
		new H.MockKeyframe({ channel: 'rotation', time: 0.25, interpolation: 'linear', data_points: [{ x: 10, y: 0, z: 45 }] })
	];
	var scaleKfs = [
		new H.MockKeyframe({ channel: 'scale', time: 0.25, interpolation: 'linear', data_points: [{ x: 1.5, y: 1.5, z: 1.5 }] })
	];
	var visKfs = [
		new H.MockKeyframe({ channel: 'visibility', time: 0.5, interpolation: 'linear', data_points: [{ visibility: false }] })
	];
	var uvKfs = [
		new H.MockKeyframe({ channel: 'uv_offset', time: 0.5, interpolation: 'linear', data_points: [{ x: 3, y: 2 }] })
	];
	var animator = new H.MockBoneAnimator({
		name: 'body', group: rootNodes[0],
		position: posKfs, rotation: rotKfs, scale: scaleKfs, visibility: visKfs, uv_offset: uvKfs
	});
	return new H.MockAnimation({ name: 'wave', length: 1, loop: 'loop', animators: [animator] });
}

// Recursive comparison of two exported node trees per the acceptance criteria.
function compareNodes(before, after, s, path) {
	path = path || before.name;
	assert.strictEqual(after.id, before.id, path + ': id changed');
	assert.strictEqual(after.name, before.name, path + ': name changed');

	// orientation unchanged
	assertVecClose(
		[after.orientation.x, after.orientation.y, after.orientation.z, after.orientation.w],
		[before.orientation.x, before.orientation.y, before.orientation.z, before.orientation.w],
		path + ': orientation changed'
	);

	// node.position scales by s
	assertScaledPoint(after.position, before.position, s, path + '.position');

	var sb = before.shape, sa = after.shape;
	assert.strictEqual(sa.type, sb.type, path + ': shape type changed');
	assert.strictEqual(sa.visible, sb.visible, path + ': visible changed');
	assert.strictEqual(sa.doubleSided, sb.doubleSided, path + ': doubleSided changed');
	assert.strictEqual(sa.shadingMode, sb.shadingMode, path + ': shadingMode changed');

	// shape.offset scales by s (true for all node types; 0*s = 0)
	assertScaledPoint(sa.offset, sb.offset, s, path + '.offset');

	if (sb.type === 'none') {
		// placeholder stretch stays [1,1,1]
		assertVecClose([sa.stretch.x, sa.stretch.y, sa.stretch.z], [sb.stretch.x, sb.stretch.y, sb.stretch.z], path + ': none-stretch changed');
	} else {
		// shape.stretch scales by s
		assertScaledPoint(sa.stretch, sb.stretch, s, path + '.stretch');
		// settings.size unchanged (deep, key-aware: quad deletes z)
		assert.deepStrictEqual(sa.settings.size, sb.settings.size, path + ': settings.size changed');
		// textureLayout unchanged
		assert.deepStrictEqual(sa.textureLayout, sb.textureLayout, path + ': textureLayout changed');
		// quad normal unchanged
		assert.strictEqual(sa.settings.normal, sb.settings.normal, path + ': quad normal changed');
		assert.strictEqual(sa.settings.isStaticBox, sb.settings.isStaticBox, path + ': isStaticBox changed');
	}
	assert.strictEqual(sa.settings.isPiece, sb.settings.isPiece, path + ': isPiece changed');

	// hierarchy: same number of children, recurse
	var cb = before.children || [];
	var ca = after.children || [];
	assert.strictEqual(ca.length, cb.length, path + ': children count changed');
	for (var i = 0; i < cb.length; i++) {
		compareNodes(cb[i], ca[i], s, path + '/' + cb[i].name);
	}
}

function assertScaledPoint(after, before, s, label) {
	['x', 'y', 'z'].forEach(function (ax) {
		if (before[ax] === undefined && after[ax] === undefined) return;
		assert.ok(P.nearlyEqual(after[ax], before[ax] * s),
			label + '.' + ax + ': expected ' + (before[ax] * s) + ' got ' + after[ax]);
	});
}

test('Integration: model export — position/offset/stretch ×0.5, size/UV/orientation unchanged', function () {
	var roots = buildRepresentativeModel();
	var before = H.compileModel(roots, 'hytale_character');
	H.applyScaleToMockTree(roots, [0, 0, 0], 0.5);
	var after = H.compileModel(roots, 'hytale_character');

	assert.strictEqual(after.nodes.length, before.nodes.length, 'node count changed');
	assert.strictEqual(after.format, before.format, 'format changed');
	for (var i = 0; i < before.nodes.length; i++) {
		compareNodes(before.nodes[i], after.nodes[i], 0.5);
	}
});

test('Integration: animation export — position deltas ×0.5; orientation/shapeStretch/uvOffset/visibility/timing unchanged', function () {
	var roots = buildRepresentativeModel();
	var anim = buildRepresentativeAnimation(roots);
	var before = H.compileAnimation(anim, 'hytale_character');
	H.applyScaleToMockAnimation(anim, 0.5);
	var after = H.compileAnimation(anim, 'hytale_character');

	assert.strictEqual(after.duration, before.duration, 'duration changed');
	assert.strictEqual(after.holdLastKeyframe, before.holdLastKeyframe, 'loop mode changed');

	var nodeB = before.nodeAnimations.body;
	var nodeA = after.nodeAnimations.body;
	assert.ok(nodeB && nodeA, 'body animation present');

	// position deltas multiplied by 0.5, timing & interpolation preserved
	assert.strictEqual(nodeA.position.length, nodeB.position.length, 'position kf count changed');
	for (var i = 0; i < nodeB.position.length; i++) {
		var pb = nodeB.position[i], pa = nodeA.position[i];
		assert.ok(P.nearlyEqual(pa.delta.x, pb.delta.x * 0.5), 'pos.x ×0.5');
		assert.ok(P.nearlyEqual(pa.delta.y, pb.delta.y * 0.5), 'pos.y ×0.5');
		assert.ok(P.nearlyEqual(pa.delta.z, pb.delta.z * 0.5), 'pos.z ×0.5');
		assert.strictEqual(pa.time, pb.time, 'kf time preserved');
		assert.strictEqual(pa.interpolationType, pb.interpolationType, 'interpolation preserved');
	}

	// orientation, shapeStretch, shapeUvOffset, shapeVisible all unchanged
	assert.deepStrictEqual(nodeA.orientation, nodeB.orientation, 'orientation changed');
	assert.deepStrictEqual(nodeA.shapeStretch, nodeB.shapeStretch, 'shapeStretch changed');
	assert.deepStrictEqual(nodeA.shapeUvOffset, nodeB.shapeUvOffset, 'shapeUvOffset changed');
	assert.deepStrictEqual(nodeA.shapeVisible, nodeB.shapeVisible, 'shapeVisible changed');
});

/* =================================================================== *
 *  Results                                                             *
 * =================================================================== */

console.log('\n────────────────────────────────────');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) {
	console.log('\nFAILURES:');
	failures.forEach(function (f) {
		console.log('  • ' + f.name);
	});
	process.exit(1);
} else {
	console.log('All tests passed.');
	process.exit(0);
}
