import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('viewer startup is driven by the capability-selected profile', async () => {
  const [main, compatibility] = await Promise.all([
    readFile(path.join(root, 'src/main.js'), 'utf8'),
    readFile(path.join(root, 'src/rendererCompatibility.js'), 'utf8'),
  ]);

  assert.match(main, /probeRendererCapabilities\(\)/);
  assert.match(main, /selectRendererProfile\(/);
  assert.match(main, /\.\.\.viewerProfileOptions/);
  assert.match(main, /createRendererRecovery\(viewer/);
  assert.match(compatibility, /showRenderLoopErrors: false/);
  assert.doesNotMatch(main, /msaaSamples:\s*4/);
});

test('mobile renderer never uses user-agent compatibility branches', async () => {
  const source = await readFile(path.join(root, 'src/rendererCompatibility.js'), 'utf8');

  assert.doesNotMatch(source, /userAgent|navigatorRef\?\.platform|iPhone|iPad|Android/);
  assert.match(source, /EXT_color_buffer_float/);
  assert.match(source, /getShaderPrecisionFormat/);
  assert.match(source, /MAX_TEXTURE_SIZE/);
});

test('safe profile gates every StyleManager post-processing entry point', async () => {
  const ui = await readFile(path.join(root, 'src/ui.js'), 'utf8');

  assert.match(ui, /rendererPostProcessingAllowed\(this\.rendererProfile\)/);
  assert.match(ui, /applyRendererProfile\(profile\)/);
  assert.match(ui, /styleName !== 'normal'\) return/);
  assert.match(ui, /this\._bloomStage\.enabled = false/);
  assert.match(ui, /this\._sharpenStage\.enabled = false/);
  assert.match(ui, /rendererFogEnabled\(/);
});

test('compatibility status is concise and accessible', async () => {
  const [markup, main] = await Promise.all([
    readFile(path.join(root, 'index.html'), 'utf8'),
    readFile(path.join(root, 'src/main.js'), 'utf8'),
  ]);

  assert.match(markup, /id="renderer-compat-status" role="status" aria-live="polite"/);
  assert.match(main, /Attempting compatibility mode/);
  assert.match(main, /Renderer restarted in/);
  assert.match(main, /rendererRecovery\?\.canRestart\(\) !== false/);
  assert.match(main, /cockpitCloudEffects\?\.lockCompatibility\(\)/);
  assert.match(main, /rendererTerminalFailure = true/);
  assert.match(main, /if \(rendererTerminalFailure\) return/);
});

test('cockpit cloud shader failures are compatibility-locked and production-sanitized', async () => {
  const clouds = await readFile(path.join(root, 'src/cockpitCloudEffects.js'), 'utf8');

  assert.match(clouds, /lockCompatibility\(\)/);
  assert.match(clouds, /this\.compatibilityLocked/);
  assert.match(clouds, /if \(import\.meta\.env\?\.DEV\)/);
  assert.match(clouds, /console\.warn\('\[Cockpit clouds\] Renderer unavailable'\)/);
});
