import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Terminal integration is feature-flagged and keeps service secrets server-side', async () => {
  const main = await readFile(path.join(root, 'src/main.js'), 'utf8');

  assert.match(main, /import\.meta\.env\.VITE_TERMINAL_INSTRUMENTS_ENABLED === 'true'/);
  assert.match(main, /VITE_TERMINAL_API_URL/);
  assert.match(main, /VITE_TERMINAL_VERIFY_ENDPOINT/);
  assert.match(main, /event\.persisted !== true/);
  assert.match(main, /window\.addEventListener\('pagehide', terminalPageHideHandler\)/);
  assert.match(main, /terminalBridge\?\.destroy\(\)/);
  assert.doesNotMatch(main, /CRON_SECRET|MOBIUS_SERVICE_SECRET/);
  assert.doesNotMatch(main, /process\.env\.TERMINAL/);
});

test('Terminal bridge is polling-first and contains no WebSocket client', async () => {
  const bridge = await readFile(
    path.join(root, 'packages/mobius-integration/terminalBridge.js'),
    'utf8',
  );

  assert.doesNotMatch(bridge, /\bWebSocket\b/);
  assert.match(bridge, /\/api\/instruments/);
  assert.match(bridge, /credentials: 'omit'/);
});

test('instrument panel participates in right-rail and overlay layout', async () => {
  const [markup, overlay, styles, ui] = await Promise.all([
    readFile(path.join(root, 'index.html'), 'utf8'),
    readFile(path.join(root, 'src/overlays/worldOverlay.js'), 'utf8'),
    readFile(path.join(root, 'src/hud/instrumentPanel.css'), 'utf8'),
    readFile(path.join(root, 'src/ui.js'), 'utf8'),
  ]);

  assert.match(markup, /id="terminal-instruments-panel"/);
  assert.match(markup, /data-panel-id="terminal-instruments-panel"/);
  assert.doesNotMatch(markup, /data-terminal-instruments-body[^>]*aria-live/);
  assert.match(overlay, /'#terminal-instruments-panel'/);
  assert.match(styles, /#right-context-rail > #terminal-instruments-panel/);
  assert.match(ui, /'terminal-instruments-panel'/);
  assert.match(ui, /panel\.hidden/);
  assert.match(ui, /style\.display !== 'none'/);
});

test('instrument renderer never injects Terminal strings through innerHTML', async () => {
  const panel = await readFile(path.join(root, 'src/hud/instrumentPanel.js'), 'utf8');

  assert.doesNotMatch(panel, /\.innerHTML\s*=/);
  assert.match(panel, /\.textContent = text/);
});
