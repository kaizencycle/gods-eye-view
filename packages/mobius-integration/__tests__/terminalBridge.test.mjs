import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeInstrumentsSnapshot,
  TerminalBridge,
  TerminalVerificationUnavailableError,
} from '../terminalBridge.js';

const SNAPSHOT = Object.freeze({
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
  mic: {
    readiness_source: 'kv',
    supply: null,
    supply_source: 'unavailable',
  },
  instruments: {
    count: null,
    errors: null,
    fallbacks_used: null,
    failed: [],
    items: [],
    cached: false,
    degraded: true,
  },
  agents: [],
  lanes: { pulse: { ok: true, instruments: 40 } },
  kv: { continuity_ok: true, diagnostic_ok: false },
  alerts: [
    { severity: 'warning', message: 'Tripwire elevated', context: 'snapshot-lite' },
  ],
});

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => structuredClone(body),
  };
}

test('normalization preserves degraded and unavailable Terminal truth', () => {
  const normalized = normalizeInstrumentsSnapshot({
    ...SNAPSHOT,
    future_field: 'forward-compatible',
  });

  assert.equal(normalized.degraded, true);
  assert.equal(normalized.gi.score, 0.81);
  assert.equal(normalized.mic.supply, null);
  assert.deepEqual(normalized.instruments.items, []);
  assert.deepEqual(normalized.agents, []);
  assert.equal(normalized.future_field, undefined);
});

test('normalization rejects an unknown schema version', () => {
  assert.throws(
    () => normalizeInstrumentsSnapshot({ ...SNAPSHOT, schema_version: 'UNKNOWN' }),
    /MOBIUS_INSTRUMENTS_1/,
  );
});

test('initialize fetches a snapshot and publishes degraded connection state', async () => {
  const requests = [];
  const bridge = new TerminalBridge({
    terminalUrl: 'https://terminal.example',
    liveUpdates: false,
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return response(SNAPSHOT);
    },
  });
  const publications = [];
  bridge.subscribe((state, status) => publications.push({ state, status }));

  const initialized = await bridge.initialize();

  assert.equal(initialized, true);
  assert.equal(requests[0].url, 'https://terminal.example/api/instruments');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(bridge.getState().cycle.id, 'C-414');
  assert.equal(bridge.getStatus().phase, 'degraded');
  assert.equal(publications.at(-1).state.gi.score, 0.81);
});

test('browser-native callables are never invoked with the bridge as receiver', async () => {
  function strictFetch() {
    assert.equal(this, undefined);
    return response(SNAPSHOT);
  }
  function strictSetTimer() {
    assert.equal(this, undefined);
    return 1;
  }
  function strictClearTimer() {
    assert.equal(this, undefined);
  }
  const bridge = new TerminalBridge({
    liveUpdates: false,
    fetchFn: strictFetch,
    setTimer: strictSetTimer,
    clearTimer: strictClearTimer,
  });

  assert.equal(await bridge.initialize(), true);
});

test('failed polling retains the last accepted snapshot', async () => {
  let shouldFail = false;
  const bridge = new TerminalBridge({
    terminalUrl: 'https://terminal.example',
    liveUpdates: false,
    fetchFn: async () => {
      if (shouldFail) throw new Error('offline');
      return response(SNAPSHOT);
    },
  });
  await bridge.initialize();
  shouldFail = true;

  const refreshed = await bridge.poll();

  assert.equal(refreshed, false);
  assert.equal(bridge.getState().gi.score, 0.81);
  assert.equal(bridge.getStatus().phase, 'offline');
  assert.match(bridge.getStatus().error, /offline/);
});

test('verification is disabled without a same-origin proxy endpoint', async () => {
  const bridge = new TerminalBridge({
    terminalUrl: 'https://terminal.example',
    liveUpdates: false,
    fetchFn: async () => response(SNAPSHOT),
  });

  await assert.rejects(
    bridge.verifyObservation({ packet_id: 'abc' }),
    TerminalVerificationUnavailableError,
  );
});

test('verification posts through a relative proxy and adopts returned instruments', async () => {
  const updated = {
    ...SNAPSHOT,
    timestamp: '2026-08-26T03:19:00.000Z',
    gi: { ...SNAPSHOT.gi, score: 0.82 },
  };
  const requests = [];
  const bridge = new TerminalBridge({
    terminalUrl: 'https://terminal.example',
    verifyEndpoint: '/api/terminal/verify',
    liveUpdates: false,
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return url === '/api/terminal/verify'
        ? response({ ok: true, accepted: false, instruments_snapshot: updated })
        : response(SNAPSHOT);
    },
  });

  const verdict = await bridge.verifyObservation({ packet_id: 'packet-1' });

  assert.equal(verdict.accepted, false);
  assert.equal(bridge.getState().gi.score, 0.82);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    packet_id: 'packet-1',
    observation: { packet_id: 'packet-1' },
  });
});

test('an older verification response cannot overwrite a newer snapshot', async () => {
  let resolveOlder;
  let requestCount = 0;
  const older = { ...SNAPSHOT, timestamp: '2026-08-26T03:18:00.000Z' };
  const newer = {
    ...SNAPSHOT,
    timestamp: '2026-08-26T03:20:00.000Z',
    gi: { ...SNAPSHOT.gi, score: 0.84 },
  };
  const bridge = new TerminalBridge({
    verifyEndpoint: '/api/terminal/verify',
    liveUpdates: false,
    fetchFn: async () => {
      requestCount++;
      if (requestCount === 1) {
        return new Promise((resolve) => {
          resolveOlder = () => resolve(response({
            ok: true,
            accepted: false,
            instruments_snapshot: older,
          }));
        });
      }
      return response({
        ok: true,
        accepted: false,
        instruments_snapshot: newer,
      });
    },
  });

  const olderRequest = bridge.verifyObservation({ packet_id: 'older' });
  await bridge.verifyObservation({ packet_id: 'newer' });
  resolveOlder();
  await olderRequest;

  assert.equal(bridge.getState().timestamp, newer.timestamp);
  assert.equal(bridge.getState().gi.score, 0.84);
});

test('verification rejects URL-confusable proxy paths', () => {
  assert.throws(
    () => new TerminalBridge({ verifyEndpoint: '/\\evil.example/path' }),
    /same-origin relative path/,
  );
});
