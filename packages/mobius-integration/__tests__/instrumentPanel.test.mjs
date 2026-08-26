import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createInstrumentPanelView,
  formatInstrumentValue,
} from '../../../src/hud/instrumentPanel.js';

const snapshot = {
  schema_version: 'MOBIUS_INSTRUMENTS_1',
  timestamp: '2026-08-26T03:18:14.703Z',
  ok: false,
  degraded: true,
  gi: {
    score: 0.81,
    provenance: 'live-compute',
    verified: true,
    conflict: false,
    floored: false,
    source: 'live',
    mode: 'green',
  },
  cycle: { id: 'C-414', execution_authorized: false },
  mic: { readiness_source: 'kv', supply: null, supply_source: 'unavailable' },
  instruments: {
    count: 40,
    errors: 1,
    fallbacks_used: 2,
    failed: [{ id: 'source-a', agent: 'ATLAS', error: 'timeout' }],
    items: [
      {
        id: 'atlas-integrity',
        agent: 'ATLAS',
        label: 'Integrity',
        score: 0.9,
        source: 'live',
      },
    ],
    cached: false,
    degraded: true,
  },
  agents: [
    { agent: 'ATLAS', score: 0.9, errorCount: 1, weight: 1 },
  ],
  lanes: {},
  kv: { continuity_ok: true, diagnostic_ok: false },
  alerts: [
    { severity: 'warning', message: '<script>not markup</script>', context: 'test' },
  ],
};

test('panel view preserves unavailable MIC instead of displaying zero', () => {
  const view = createInstrumentPanelView(snapshot, { phase: 'degraded' }, null);

  assert.equal(view.gi.value, '0.810');
  assert.equal(view.cycle.value, 'C-414');
  assert.equal(view.mic.visible, false);
  assert.equal(view.mic.value, '—');
  assert.equal(view.instruments.value, '40');
  assert.equal(view.connection.tone, 'warning');
});

test('panel view carries every supplied instrument and real agent composite', () => {
  const view = createInstrumentPanelView(snapshot, { phase: 'connected' }, null);

  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].label, 'Integrity');
  assert.equal(view.agents.length, 1);
  assert.equal(view.agents[0].name, 'ATLAS');
  assert.equal(view.agents[0].score, '0.900');
});

test('panel view keeps remote alert text as inert text data', () => {
  const view = createInstrumentPanelView(snapshot, { phase: 'degraded' }, null);

  assert.equal(view.alerts[0].message, '<script>not markup</script>');
});

test('formatInstrumentValue never turns null into a healthy-looking zero', () => {
  assert.equal(formatInstrumentValue(null), '—');
  assert.equal(formatInstrumentValue(undefined), '—');
  assert.equal(formatInstrumentValue(0), '0');
});

test('panel view labels pre-snapshot instrument and KV state as unknown', () => {
  const view = createInstrumentPanelView(null, { phase: 'loading' }, null);

  assert.equal(view.instruments.detail, 'UNAVAILABLE');
  assert.equal(view.instruments.tone, 'warning');
  assert.equal(view.kv.value, 'UNKNOWN');
  assert.equal(view.kv.detail, 'diagnostics unknown');
  assert.equal(view.cycle.detail, 'UNKNOWN');
});

test('offline panel marks retained Terminal values stale', () => {
  const nominal = {
    ...snapshot,
    ok: true,
    degraded: false,
    instruments: { ...snapshot.instruments, degraded: false },
    kv: { continuity_ok: true, diagnostic_ok: true },
  };
  const view = createInstrumentPanelView(nominal, { phase: 'offline' }, null);

  assert.equal(view.connection.label, 'OFFLINE');
  assert.match(view.connection.detail, /cached snapshot stale/i);
  assert.equal(view.gi.tone, 'warning');
  assert.equal(view.instruments.tone, 'warning');
  assert.match(view.instruments.detail, /^STALE/);
  assert.match(view.kv.detail, /^stale/);
});

test('initial offline state does not claim a cached snapshot exists', () => {
  const view = createInstrumentPanelView(null, { phase: 'offline' }, null);

  assert.equal(view.connection.detail, 'No Terminal snapshot available');
  assert.doesNotMatch(view.instruments.detail, /STALE/);
  assert.doesNotMatch(view.kv.detail, /stale/);
});

test('local packet evidence remains pending when verification is unavailable', () => {
  const view = createInstrumentPanelView(snapshot, { phase: 'connected' }, {
    status: 'pending',
    packetId: 'abcdef1234567890',
    verdict: null,
    error: null,
  });

  assert.equal(view.evidence.visible, true);
  assert.equal(view.evidence.packetId, 'abcdef123456');
  assert.equal(view.evidence.label, 'PENDING TERMINAL VERIFY');
});
