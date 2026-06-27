/*
 * Test harness for Hytale UV-Preserving Scale.
 *
 * This file provides:
 *   1. Minimal mock Cube/Group/Keyframe/Animation objects matching the fields
 *      the official Hytale exporter reads.
 *   2. A port of the official exporter logic from the Hytale plugin
 *      (src/blockymodel.ts `compile`/`turnNodeIntoBox`/`getNodeOffset`/`compileNode`
 *      and src/blockyanim.ts `compileAnimationFile`). This lets the integration
 *      test export the model to .blockymodel/.blockyanim JSON before and after
 *      scaling and compare the structures — exactly the acceptance test the spec
 *      describes — WITHOUT needing a running Blockbench instance.
 *
 * The plugin itself never exports/reimports; this exporter port exists only to
 * validate that the live transformation is equivalent to scaling the exported
 * node.position / shape.offset / shape.stretch by s while leaving size / UV /
 * orientation untouched.
 */

'use strict';

var PURE = require('../src/hytale_uv_preserving_scale.js');

/* --------------------------------------------------------------------- *
 *  Mock element classes (real classes so `instanceof` works in the port)*
 * --------------------------------------------------------------------- */

var _uuid = 0;
function nextUuid() { _uuid += 1; return 'uuid-' + _uuid; }

function MockGroup(opts) {
	opts = opts || {};
	this.uuid = opts.uuid || nextUuid();
	this.name = opts.name || 'group';
	this.origin = (opts.origin || [0, 0, 0]).slice();
	this.rotation = (opts.rotation || [0, 0, 0]).slice();
	this.visibility = opts.visibility !== false;
	this.export = opts.export !== false;
	this.is_piece = !!opts.is_piece;
	// Hytale custom vector properties (present only on Hytale groups).
	this.original_offset = opts.original_offset ? opts.original_offset.slice() : [0, 0, 0];
	this.original_position = opts.original_position ? opts.original_position.slice() : [0, 0, 0];
	this.children = [];
	this.parent = 'root';
}
MockGroup.prototype.add = function (child) {
	child.parent = this;
	this.children.push(child);
	return child;
};

function defaultFaces() {
	var faces = {};
	['north', 'east', 'south', 'west', 'up', 'down'].forEach(function (fk) {
		faces[fk] = { uv: [0, 0, 0, 0], rotation: 0, texture: null, enabled: true };
	});
	return faces;
}

function MockCube(opts) {
	opts = opts || {};
	this.uuid = opts.uuid || nextUuid();
	this.name = opts.name || 'cube';
	this.from = (opts.from || [0, 0, 0]).slice();
	this.to = (opts.to || [1, 1, 1]).slice();
	this.origin = (opts.origin || [0, 0, 0]).slice();
	this.rotation = (opts.rotation || [0, 0, 0]).slice();
	this.stretch = (opts.stretch || [1, 1, 1]).slice();
	this.visibility = opts.visibility !== false;
	this.export = opts.export !== false;
	this.double_sided = !!opts.double_sided;
	this.shading_mode = opts.shading_mode || 'flat';
	this.faces = opts.faces || defaultFaces();
	this.children = undefined;
	this.parent = 'root';
}
MockCube.prototype.size = function (axis) {
	var s = [this.to[0] - this.from[0], this.to[1] - this.from[1], this.to[2] - this.from[2]];
	return axis === undefined ? s : s[axis];
};

/* --------------------------------------------------------------------- *
 *  Mock keyframe / animator / animation                                 *
 * --------------------------------------------------------------------- */

function MockKeyframe(opts) {
	this.channel = opts.channel;
	this.time = opts.time;
	this.interpolation = opts.interpolation || 'linear';
	this.uuid = nextUuid();
	// data_points: array of plain objects with axis keys (x,y,z) or visibility.
	this.data_points = opts.data_points.map(function (dp) {
		var copy = {};
		for (var k in dp) copy[k] = dp[k];
		return copy;
	});
}
MockKeyframe.prototype.get = function (axis, dp) {
	dp = dp || 0;
	return this.data_points[dp][axis];
};
MockKeyframe.prototype.set = function (axis, value, dp) {
	dp = dp || 0;
	this.data_points[dp][axis] = value;
	return this;
};
MockKeyframe.prototype.calc = function (axis, dp) {
	var v = this.get(axis, dp);
	return typeof v === 'number' ? v : parseFloat(v);
};

// A bone animator stores per-channel keyframe arrays accessed as animator[channel].
function MockBoneAnimator(opts) {
	this.uuid = opts.uuid || nextUuid();
	this.name = opts.name || 'animator';
	this.group = opts.group || null;
	this.position = opts.position || [];
	this.rotation = opts.rotation || [];
	this.scale = opts.scale || [];
	this.visibility = opts.visibility || [];
	this.uv_offset = opts.uv_offset || [];
}
MockBoneAnimator.prototype.getGroup = function () { return this.group; };

function MockAnimation(opts) {
	this.uuid = nextUuid();
	this.name = opts.name || 'animation';
	this.length = opts.length || 1;
	this.loop = opts.loop || 'loop';
	this.saved = true;
	this.animators = {};
	(opts.animators || []).forEach(function (an) { this.animators[an.uuid] = an; }, this);
}

/* --------------------------------------------------------------------- *
 *  Helpers shared with the official exporter port                       *
 * --------------------------------------------------------------------- */

function lerp(a, b, t) { return a + (b - a) * t; }
function degToRad(d) { return d * Math.PI / 180; }
function formatVector(arr) { return { x: arr[0], y: arr[1], z: arr[2] }; }

// THREE.Quaternion.setFromEuler with order 'ZYX' (ported from three.js). Only
// used so `orientation` is produced deterministically; rotations are never
// changed by scaling, so orientation is identical before/after regardless.
function eulerToQuaternion(rx, ry, rz, order) {
	order = order || 'ZYX';
	var c1 = Math.cos(rx / 2), c2 = Math.cos(ry / 2), c3 = Math.cos(rz / 2);
	var s1 = Math.sin(rx / 2), s2 = Math.sin(ry / 2), s3 = Math.sin(rz / 2);
	var q = { x: 0, y: 0, z: 0, w: 1 };
	switch (order) {
		case 'XYZ':
			q.x = s1 * c2 * c3 + c1 * s2 * s3;
			q.y = c1 * s2 * c3 - s1 * c2 * s3;
			q.z = c1 * c2 * s3 + s1 * s2 * c3;
			q.w = c1 * c2 * c3 - s1 * s2 * s3;
			break;
		case 'ZYX':
		default:
			q.x = s1 * c2 * c3 - c1 * s2 * s3;
			q.y = c1 * s2 * c3 + s1 * c2 * s3;
			q.z = c1 * c2 * s3 - s1 * s2 * c3;
			q.w = c1 * c2 * c3 + s1 * s2 * s3;
			break;
	}
	return q;
}

function qualifiesAsMainShape(node) {
	return node instanceof MockCube && node.rotation.every(function (r) { return r === 0; });
}
function getMainShape(group) {
	return group.children.find(qualifiesAsMainShape);
}
function cubeIsQuad(cube) {
	if (!cube.size().some(function (v) { return v === 0; })) return false;
	var textured = Object.keys(cube.faces).filter(function (fk) { return cube.faces[fk].texture !== null; });
	if (textured.length > 1) return false;
	return true;
}

/* --------------------------------------------------------------------- *
 *  Ported exporter: model -> .blockymodel JSON                          *
 *  (port of src/blockymodel.ts compile(), non-attachment path) *
 * --------------------------------------------------------------------- */

function compileModel(rootNodes, formatId) {
	var model = {
		nodes: [],
		format: formatId === 'hytale_prop' ? 'prop' : 'character',
		lod: 'auto'
	};
	var node_id = { v: 1 };

	function turnNodeIntoBox(node, cube, original_element) {
		var size = cube.size();
		var stretch = cube.stretch.slice();
		var offset = [
			lerp(cube.from[0], cube.to[0], 0.5) - original_element.origin[0],
			lerp(cube.from[1], cube.to[1], 0.5) - original_element.origin[1],
			lerp(cube.from[2], cube.to[2], 0.5) - original_element.origin[2]
		];
		node.shape.type = 'box';
		node.shape.settings.size = formatVector(size);
		node.shape.offset = formatVector(offset);

		if (cubeIsQuad(cube)) {
			node.shape.type = 'quad';
			var used_face = Object.keys(cube.faces).find(function (fk) { return cube.faces[fk].texture != null; });
			var normal = '+Z';
			switch (used_face) {
				case 'west': normal = '-X'; break;
				case 'east': normal = '+X'; break;
				case 'down': normal = '-Y'; break;
				case 'up': normal = '+Y'; break;
				case 'north': normal = '-Z'; break;
				case 'south': normal = '+Z'; break;
			}
			node.shape.settings.normal = normal;
			delete node.shape.settings.size.z;
			if (normal.endsWith('X')) {
				node.shape.settings.size.x = size[2];
			} else if (normal.endsWith('Y')) {
				node.shape.settings.size.y = size[2];
			}
		}
		node.shape.stretch = formatVector(stretch);
		node.shape.visible = cube.visibility;
		node.shape.doubleSided = cube.double_sided === true;
		node.shape.shadingMode = cube.shading_mode;
		node.shape.unwrapMode = 'custom';
		if (cube === original_element) node.shape.settings.isStaticBox = true;

		var BBToHytaleDirection = {
			north: 'back', south: 'front', west: 'left', east: 'right', up: 'top', down: 'bottom'
		};
		for (var fkey in cube.faces) {
			var face = cube.faces[fkey];
			if (face.texture == null) continue;
			var direction = BBToHytaleDirection[fkey];
			if (node.shape.type === 'quad') direction = 'front';

			var flip_x = false, flip_y = false;
			var uv_x = Math.min(face.uv[0], face.uv[2]);
			var uv_y = Math.min(face.uv[1], face.uv[3]);
			function flipMinMax(isX) {
				if (isX) {
					flip_x = !flip_x;
					uv_x = flip_x ? Math.max(face.uv[0], face.uv[2]) : Math.min(face.uv[0], face.uv[2]);
				} else {
					flip_y = !flip_y;
					uv_y = flip_y ? Math.max(face.uv[1], face.uv[3]) : Math.min(face.uv[1], face.uv[3]);
				}
			}
			var mirror_x = false, mirror_y = false;
			if (face.uv[0] > face.uv[2]) { mirror_x = true; flipMinMax(true); }
			if (face.uv[1] > face.uv[3]) { mirror_y = true; flipMinMax(false); }

			var uv_rot = 0;
			switch (face.rotation) {
				case 90:
					uv_rot = 270;
					if ((mirror_x || mirror_y) && !(mirror_x && mirror_y)) uv_rot = 90;
					flipMinMax(false);
					break;
				case 180:
					uv_rot = 180;
					flipMinMax(false);
					flipMinMax(true);
					break;
				case 270:
					uv_rot = 90;
					if ((mirror_x || mirror_y) && !(mirror_x && mirror_y)) uv_rot = 270;
					flipMinMax(true);
					break;
			}

			node.shape.textureLayout[direction] = {
				offset: { x: Math.round(uv_x), y: Math.round(uv_y) },
				mirror: { x: mirror_x, y: mirror_y },
				angle: uv_rot
			};
		}
	}

	function getNodeOffset(group, include_original_offset) {
		if (include_original_offset === undefined) include_original_offset = true;
		var cube = getMainShape(group);
		if (cube) {
			return [
				(cube.from[0] + cube.to[0]) / 2 - group.origin[0],
				(cube.from[1] + cube.to[1]) / 2 - group.origin[1],
				(cube.from[2] + cube.to[2]) / 2 - group.origin[2]
			];
		} else if (include_original_offset) {
			return group.original_offset;
		}
		return [0, 0, 0];
	}

	function compileNode(element, name) {
		if (name === undefined) name = element.name;
		if (!element.export) return undefined;

		var q = eulerToQuaternion(
			degToRad(element.rotation[0]),
			degToRad(element.rotation[1]),
			degToRad(element.rotation[2]),
			'ZYX'
		);
		var orientation = { x: q.x, y: q.y, z: q.z, w: q.w };
		var origin = element.origin.slice();
		var offset = (element instanceof MockGroup) ? getNodeOffset(element) : [0, 0, 0];

		if (element.parent instanceof MockGroup) {
			origin = [origin[0] - element.parent.origin[0], origin[1] - element.parent.origin[1], origin[2] - element.parent.origin[2]];
			var parent_offset = getNodeOffset(element.parent, true);
			if (parent_offset) {
				origin = [origin[0] - parent_offset[0], origin[1] - parent_offset[1], origin[2] - parent_offset[2]];
			}
		}

		var node = {
			id: String(node_id.v),
			name: name.replace(/^.+:/, ''),
			position: formatVector(origin),
			orientation: orientation,
			shape: {
				type: 'none',
				offset: formatVector(offset),
				stretch: formatVector([1, 1, 1]),
				settings: { isPiece: (element instanceof MockGroup && element.is_piece) || false },
				textureLayout: {},
				unwrapMode: 'custom',
				visible: element.visibility,
				doubleSided: false,
				shadingMode: 'flat'
			}
		};
		node_id.v += 1;

		if (element instanceof MockCube) {
			turnNodeIntoBox(node, element, element);
		} else if (element.children) {
			var shape_count = 0;
			var child_cube_count = 0;
			for (var i = 0; i < element.children.length; i++) {
				var child = element.children[i];
				if (!child.export) continue;
				var result;
				if (qualifiesAsMainShape(child) && shape_count === 0) {
					turnNodeIntoBox(node, child, element);
					shape_count++;
				} else if (child instanceof MockCube) {
					child_cube_count++;
					result = compileNode(child, child.name + '--C' + child_cube_count);
				} else if (child instanceof MockGroup) {
					result = compileNode(child);
				}
				if (result) {
					if (!node.children) node.children = [];
					node.children.push(result);
				}
			}
		}
		return node;
	}

	var nodes = rootNodes.filter(function (n) { return n instanceof MockGroup || n instanceof MockCube; });
	for (var i = 0; i < nodes.length; i++) {
		var compiled = compileNode(nodes[i]);
		if (compiled) model.nodes.push(compiled);
	}
	return model;
}

/* --------------------------------------------------------------------- *
 *  Ported exporter: animation -> .blockyanim JSON                       *
 *  (port of src/blockyanim.ts compileAnimationFile)            *
 * --------------------------------------------------------------------- */

function compileAnimation(animation, formatId) {
	var FPS = 60;
	var nodeAnimations = {};
	var file = {
		formatVersion: 1,
		duration: Math.round(animation.length * FPS) || FPS * 2,
		holdLastKeyframe: animation.loop === 'hold',
		nodeAnimations: nodeAnimations
	};
	var channels = {
		position: 'position',
		rotation: 'orientation',
		scale: 'shapeStretch',
		visibility: 'shapeVisible',
		uv_offset: 'shapeUvOffset'
	};
	for (var uuid in animation.animators) {
		var animator = animation.animators[uuid];
		var name = animator.name;
		var node_data = {};
		var has_data = false;

		for (var channel in channels) {
			var hytale_key = channels[channel];
			var timeline = node_data[hytale_key] = [];
			var keyframe_list = (animator[channel] && Array.isArray(animator[channel])) ? animator[channel].slice() : [];
			keyframe_list.sort(function (a, b) { return a.time - b.time; });
			for (var i = 0; i < keyframe_list.length; i++) {
				var kf = keyframe_list[i];
				var data_point = kf.data_points[0];
				var delta;
				if (channel === 'visibility') {
					delta = data_point.visibility;
				} else if (channel === 'uv_offset') {
					delta = { x: Math.round(parseFloat(data_point.x)), y: -Math.round(parseFloat(data_point.y)) };
				} else if (channel === 'rotation') {
					var q = eulerToQuaternion(
						degToRad(kf.calc('x')), degToRad(kf.calc('y')), degToRad(kf.calc('z')), 'ZYX'
					);
					delta = { x: q.x, y: q.y, z: q.z, w: q.w };
				} else {
					delta = { x: kf.calc('x'), y: kf.calc('y'), z: kf.calc('z') };
				}
				timeline.push({
					time: Math.round(kf.time * FPS),
					delta: delta,
					interpolationType: kf.interpolation === 'catmullrom' ? 'smooth' : 'linear'
				});
				has_data = true;
			}
		}
		if (has_data) {
			if (!node_data.shapeUvOffset) node_data.shapeUvOffset = [];
			nodeAnimations[name] = node_data;
		}
	}
	return file;
}

/* --------------------------------------------------------------------- *
 *  Apply the plugin's transformation to mock objects                    *
 *  (mirrors the live applyGroupTransform/applyCubeTransform/keyframes)   *
 * --------------------------------------------------------------------- */

function collectMock(rootNodes) {
	var cubes = [], groups = [];
	function walk(node) {
		if (node instanceof MockGroup) groups.push(node);
		else if (node instanceof MockCube) cubes.push(node);
		if (node.children) node.children.forEach(walk);
	}
	rootNodes.forEach(walk);
	return { cubes: cubes, groups: groups };
}

function writeVec(target, src) {
	for (var i = 0; i < src.length; i++) target[i] = PURE.normalizeZero(src[i]);
}

function applyScaleToMockTree(rootNodes, pivot, s) {
	var collected = collectMock(rootNodes);
	collected.groups.forEach(function (g) {
		var res = PURE.transformGroupData({
			origin: g.origin,
			original_offset: g.original_offset,
			original_position: g.original_position
		}, pivot, s);
		writeVec(g.origin, res.origin);
		if (res.original_offset) writeVec(g.original_offset, res.original_offset);
		if (res.original_position) writeVec(g.original_position, res.original_position);
	});
	collected.cubes.forEach(function (c) {
		var res = PURE.transformCubeData({ from: c.from, to: c.to, origin: c.origin, stretch: c.stretch }, pivot, s);
		writeVec(c.from, res.from);
		writeVec(c.to, res.to);
		writeVec(c.origin, res.origin);
		writeVec(c.stretch, res.stretch);
	});
	return collected;
}

function applyScaleToMockAnimation(animation, s) {
	for (var uuid in animation.animators) {
		var animator = animation.animators[uuid];
		var posKfs = animator.position || [];
		posKfs.forEach(function (kf) {
			for (var dp = 0; dp < kf.data_points.length; dp++) {
				kf.set('x', PURE.scaleKeyframeValue(kf.get('x', dp), s), dp);
				kf.set('y', PURE.scaleKeyframeValue(kf.get('y', dp), s), dp);
				kf.set('z', PURE.scaleKeyframeValue(kf.get('z', dp), s), dp);
			}
		});
	}
}

module.exports = {
	PURE: PURE,
	MockGroup: MockGroup,
	MockCube: MockCube,
	MockKeyframe: MockKeyframe,
	MockBoneAnimator: MockBoneAnimator,
	MockAnimation: MockAnimation,
	defaultFaces: defaultFaces,
	compileModel: compileModel,
	compileAnimation: compileAnimation,
	collectMock: collectMock,
	applyScaleToMockTree: applyScaleToMockTree,
	applyScaleToMockAnimation: applyScaleToMockAnimation,
	eulerToQuaternion: eulerToQuaternion
};
