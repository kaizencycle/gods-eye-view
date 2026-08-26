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
  const selection = source.slice(
    source.indexOf('export function selectRendererProfile'),
    source.indexOf('export function rendererProfileOverride'),
  );

  assert.doesNotMatch(selection, /userAgent|platform|iPhone|iPad|Android/);
  assert.match(source, /EXT_color_buffer_float/);
  assert.match(source, /getShaderPrecisionFormat/);
  assert.match(source, /MAX_TEXTURE_SIZE/);
});

test('mobile and minimal profiles gate every StyleManager post-processing entry point', async () => {
  const ui = await readFile(path.join(root, 'src/ui.js'), 'utf8');

  assert.match(ui, /rendererPostProcessingAllowed\(this\.rendererProfile\)/);
  assert.match(ui, /applyRendererProfile\(profile\)/);
  assert.match(ui, /styleName !== 'normal'\) return/);
  assert.match(ui, /this\._bloomStage\.enabled = false/);
  assert.match(ui, /this\._sharpenStage\.enabled = false/);
  assert.match(ui, /rendererFogEnabled\(/);
  assert.match(ui, /const models3dAvailable = profile\.sceneMode === '3d'/);
  assert.match(ui, /const rendererAllowsModels = this\.rendererProfile\?\.sceneMode === '3d'/);
  assert.match(ui, /Search requires a Google Maps key/);
});

test('compatibility status is concise and accessible', async () => {
  const [markup, main] = await Promise.all([
    readFile(path.join(root, 'index.html'), 'utf8'),
    readFile(path.join(root, 'src/main.js'), 'utf8'),
  ]);

  assert.match(markup, /id="renderer-compat-status" role="status" aria-live="polite"/);
  assert.match(main, /Optimizing renderer/);
  assert.match(main, /Renderer restarted in/);
  assert.match(main, /rendererRecovery\?\.canRestart\(\) !== false/);
  assert.match(main, /cockpitCloudEffects\?\.lockCompatibility\(\)/);
  assert.match(main, /rendererRequiresRecreation\(/);
  assert.match(main, /window\.location\.replace\(rendererFallbackUrl/);
  assert.match(main, /rendererTerminalFailure = true/);
  assert.match(main, /if \(rendererTerminalFailure\) return/);
  assert.match(main, /bootStaticWorldFallback/);
  assert.match(main, /sceneMode2D: Cesium\.SceneMode\.SCENE2D/);
  assert.match(main, /isRendererStartupError\(error\)/);
  assert.match(main, /nextRendererProfile\(rendererProfile\)/);
  assert.match(main, /rendererProfileForMapKey\(rendererProfile, false\)/);
  assert.match(main, /Loading \$\{rendererProfile\.id\} OpenStreetMap renderer/);
});

test('cockpit cloud shader failures are compatibility-locked and production-sanitized', async () => {
  const clouds = await readFile(path.join(root, 'src/cockpitCloudEffects.js'), 'utf8');

  assert.match(clouds, /lockCompatibility\(\)/);
  assert.match(clouds, /this\.compatibilityLocked/);
  assert.match(clouds, /if \(import\.meta\.env\?\.DEV\)/);
  assert.match(clouds, /console\.warn\('\[Cockpit clouds\] Renderer unavailable'\)/);
});
