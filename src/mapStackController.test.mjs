import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MapStackController } from './mapStackController.js';

test('minimal renderer installs flat terrain without a network terrain probe', async () => {
  const viewer = {
    scene: {},
    terrainProvider: null,
  };
  const controller = new MapStackController(viewer, {
    initialStack: 'osm',
    allowTerrain: false,
  });

  await controller._setWorldTerrainEnabled(false);

  assert.equal(controller._terrainMode, 'flat');
  assert.equal(viewer.terrainProvider.constructor.name, 'EllipsoidTerrainProvider');
});
