import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('startup no longer imports or invokes the Austin development default', async () => {
  const main = await readFile(path.join(root, 'src/main.js'), 'utf8');

  assert.doesNotMatch(main, /flyToAustin/);
  assert.doesNotMatch(main, /Flying to Austin/);
  assert.match(main, /chooseInitialCamera/);
  assert.match(main, /setDefaultGlobeView/);
});

test('startup explicitly implements share, session, globe precedence', async () => {
  const main = await readFile(path.join(root, 'src/main.js'), 'utf8');

  assert.match(main, /shareState:\s*styleManager\.hasShareState/);
  assert.match(main, /savedState:\s*readCameraSession/);
  assert.match(main, /initialCamera\.source === 'session'/);
  assert.match(main, /initialCamera\.source === 'globe'/);
  assert.match(main, /styleManager\.addDisposeCallback/);
  assert.match(main, /cameraSessionPersistence\?\.destroy\(\{ save: true \}\)/);
});

test('home reset and startup use the same canonical GLOBE_VIEW', async () => {
  const [main, locations, ui] = await Promise.all([
    readFile(path.join(root, 'src/main.js'), 'utf8'),
    readFile(path.join(root, 'src/locations.js'), 'utf8'),
    readFile(path.join(root, 'src/ui.js'), 'utf8'),
  ]);

  assert.match(main, /setDefaultGlobeView\(viewer\)/);
  assert.match(locations, /longitudeDeg:\s*0/);
  assert.match(locations, /latitudeDeg:\s*0/);
  assert.match(ui, /flyToGlobeView\(this\.viewer/);
  assert.match(ui, /if \(!this\.orbitController\.active\) this\._stampNavigation\(\)/);
  assert.match(ui, /this\._currentTarget = null/);
});
