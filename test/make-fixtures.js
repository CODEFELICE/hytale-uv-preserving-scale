/*
 * Generates the before/after export fixtures used as tangible evidence of the
 * integration acceptance test. Builds a representative model + animation,
 * exports them (via the ported official exporter in harness.js), scales by 0.5,
 * exports again, and writes all four files to test/fixtures/.
 *
 * Run with:  node test/make-fixtures.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var H = require('./harness.js');

var DIR = path.join(__dirname, 'fixtures');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function buildModel() {
	var root = new H.MockGroup({ name: 'body', origin: [0, 12, 0] });
	var body = new H.MockCube({ name: 'body', from: [-4, 8, -2], to: [4, 16, 2], origin: [0, 12, 0], stretch: [1.5, 0.75, 2], shading_mode: 'standard' });
	body.faces.south.texture = 'tex'; body.faces.south.uv = [8, 0, 0, 8];                        // mirrored on X
	body.faces.north.texture = 'tex'; body.faces.north.uv = [0, 0, 8, 8]; body.faces.north.rotation = 90; // rotated
	root.add(body);

	var arm = new H.MockGroup({ name: 'arm', origin: [5, 14, 0], rotation: [0, 0, -35] });
	var armS = new H.MockCube({ name: 'arm', from: [4, 6, -1.5], to: [7, 14, 1.5], origin: [5, 14, 0], stretch: [1, 2, 1] });
	armS.faces.east.texture = 'tex'; armS.faces.east.uv = [0, 0, 3, 8];
	arm.add(armS);
	root.add(arm);

	var flag = new H.MockGroup({ name: 'flag', origin: [0, 20, 4] });
	var quad = new H.MockCube({ name: 'flag', from: [-3, 18, 4], to: [3, 24, 4], origin: [0, 21, 4], stretch: [1, 1, 1] });
	quad.faces.south.texture = 'tex'; quad.faces.south.uv = [0, 0, 6, 6]; quad.faces.south.rotation = 180;
	flag.add(quad);
	root.add(flag);

	var attach = new H.MockGroup({ name: 'attach_point', origin: [0, 16, 0], original_offset: [0, 4, -3], is_piece: true });
	root.add(attach);
	return [root];
}

function buildAnimation(rootNodes) {
	var posKfs = [
		new H.MockKeyframe({ channel: 'position', time: 0, interpolation: 'linear', data_points: [{ x: 0, y: 0, z: 0 }] }),
		new H.MockKeyframe({ channel: 'position', time: 0.5, interpolation: 'catmullrom', data_points: [{ x: 6, y: -10, z: 4 }] })
	];
	var rotKfs = [new H.MockKeyframe({ channel: 'rotation', time: 0.25, interpolation: 'linear', data_points: [{ x: 10, y: 0, z: 45 }] })];
	var sclKfs = [new H.MockKeyframe({ channel: 'scale', time: 0.25, interpolation: 'linear', data_points: [{ x: 1.5, y: 1.5, z: 1.5 }] })];
	var uvKfs = [new H.MockKeyframe({ channel: 'uv_offset', time: 0.5, interpolation: 'linear', data_points: [{ x: 3, y: 2 }] })];
	var an = new H.MockBoneAnimator({ name: 'body', group: rootNodes[0], position: posKfs, rotation: rotKfs, scale: sclKfs, uv_offset: uvKfs });
	return new H.MockAnimation({ name: 'wave', length: 1, loop: 'loop', animators: [an] });
}

function write(name, obj) {
	fs.writeFileSync(path.join(DIR, name), JSON.stringify(obj, null, '\t') + '\n');
}

// Model before/after
var roots = buildModel();
write('model.before.blockymodel', H.compileModel(roots, 'hytale_character'));
H.applyScaleToMockTree(roots, [0, 0, 0], 0.5);
write('model.after.blockymodel', H.compileModel(roots, 'hytale_character'));

// Animation before/after
var roots2 = buildModel();
var anim = buildAnimation(roots2);
write('anim.before.blockyanim', H.compileAnimation(anim, 'hytale_character'));
H.applyScaleToMockAnimation(anim, 0.5);
write('anim.after.blockyanim', H.compileAnimation(anim, 'hytale_character'));

console.log('✓ Wrote fixtures to test/fixtures/ (model + animation, before & after ×0.5).');
