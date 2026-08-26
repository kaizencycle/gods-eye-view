import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { staticFallbackMapUrl } from './staticWorldFallback.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('static fallback uses attributed OpenStreetMap embed centered on Austin', () => {
  const url = new URL(staticFallbackMapUrl());

  assert.equal(url.origin, 'https://www.openstreetmap.org');
  assert.equal(url.pathname, '/export/embed.html');
  assert.equal(url.searchParams.get('layer'), 'mapnik');
  assert.equal(url.searchParams.get('marker'), '30.2672,-97.7431');
});

test('static fallback never claims Cesium event layers are live', async () => {
  const source = await readFile(path.join(root, 'src/staticWorldFallback.js'), 'utf8');

  assert.match(source, /Live Cesium event layers are unavailable/);
  assert.match(source, /no event markers are synthesized/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
});

test('static fallback provides search, context, attribution, and retry profiles', async () => {
  const source = await readFile(path.join(root, 'src/staticWorldFallback.js'), 'utf8');

  assert.match(source, /OpenStreetMap, search, and context remain accessible/);
  assert.match(source, /www\.openstreetmap\.org\/search/);
  assert.match(source, /© OpenStreetMap contributors/);
  assert.match(source, /terminal\.mobius-substrate\.com/);
  assert.match(source, /new URL\(terminalUrl\)/);
  assert.match(source, /Renderer diagnostics/);
  for (const profile of ['minimal', 'mobile', 'balanced', 'high', 'ultra']) {
    assert.match(source, new RegExp(`['\"]${profile}['\"]`));
  }
});
