import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import flightsLayer from './flights.js';
import militaryFlightsLayer from './militaryFlights.js';

test('renderer model gate is independent from the operator 3D preference', () => {
  flightsLayer.setParams({ rendererModelsAllowed: false });
  militaryFlightsLayer.setParams({ rendererModelsAllowed: false });

  assert.equal(flightsLayer.getParams().rendererModelsAllowed, false);
  assert.equal(militaryFlightsLayer.getParams().rendererModelsAllowed, false);
  assert.equal(flightsLayer.getParams().models3d, true);
  assert.equal(militaryFlightsLayer.getParams().models3d, true);

  flightsLayer.setParams({ rendererModelsAllowed: true });
  militaryFlightsLayer.setParams({ rendererModelsAllowed: true });
});

test('renderer model gate covers preload, fleet, and tracked regimes', async () => {
  const [flights, military] = await Promise.all([
    readFile(new URL('./flights.js', import.meta.url), 'utf8'),
    readFile(new URL('./militaryFlights.js', import.meta.url), 'utf8'),
  ]);

  for (const source of [flights, military]) {
    assert.match(source, /_rendererModelsAllowed && !_preloadModel/);
    assert.match(source, /if \(!_rendererModelsAllowed \|\| !_models3dEnabled\) return false/);
    assert.match(source, /if \(!_rendererModelsAllowed \|\| !_trackedIcao/);
  }
});
