import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJavaScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') {
      files.push(...await readJavaScriptFiles(absolute));
    } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

test('main wires the invisible adapter through public earthquake records', async () => {
  const source = await readFile(path.join(root, 'src/main.js'), 'utf8');
  const attachAt = source.indexOf('attachMobiusAdapter({');
  const finalizeAt = source.indexOf('dataManager.finalizeRegistrations(');
  const restoreAt = source.indexOf('styleManager.attachDataManager(dataManager)');

  assert.ok(finalizeAt >= 0 && attachAt > finalizeAt);
  assert.ok(restoreAt > attachAt);
  assert.match(source, /getRecords:\s*\(\)\s*=>\s*earthquakesLayer\.getAnalystRecords\(\)/);
  assert.match(source, /mobiusAdapter,/);
});

test('Mobius runtime package contains no network or AI integration', async () => {
  const packageRoot = path.join(root, 'packages/mobius-integrity');
  const files = await readJavaScriptFiles(packageRoot);
  const combined = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(manifest.dependencies, undefined);
  assert.doesNotMatch(combined, /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/);
  assert.doesNotMatch(combined, /\bOpenAI\b|\bLLM\b|\bZEUS\b|\bHERMES\b|\bOAA\b/);
});
