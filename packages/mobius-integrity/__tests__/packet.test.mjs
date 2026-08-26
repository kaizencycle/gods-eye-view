import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalize,
  computeFingerprint,
  validateFingerprint,
} from '../hashing/computeFingerprint.js';
import { createPacket } from '../packet/createPacket.js';
import { replayPacket } from '../packet/replayPacket.js';
import {
  deserializePacket,
  serializePacket,
} from '../packet/serializePacket.js';

const OBSERVATION = Object.freeze({
  eventId: 'us7000abc1',
  eventType: 'earthquake',
  observedAt: '2026-08-25T14:32:00Z',
  source: 'USGS',
  location: {
    latitude: 37.8,
    longitude: -122.4,
    depthKm: 8.5,
  },
  properties: {
    magnitude: 5.2,
    place: 'San Francisco Bay Area',
    sourceTimestamp: '2026-08-25T14:30:00Z',
  },
});

test('createPacket creates a schema-valid earthquake packet', async () => {
  const packet = await createPacket(OBSERVATION);

  assert.equal(packet.packet_version, '0.1');
  assert.equal(packet.event_id, 'usgs:us7000abc1');
  assert.equal(packet.event_type, 'earthquake');
  assert.equal(packet.source, 'USGS');
  assert.equal(packet.renderer, 'gods-eye-view');
  assert.equal(packet.freshness, 'unassessed');
  assert.equal(packet.confidence, 'unassessed');
  assert.equal(packet.packet_id, packet.fingerprint);
  assert.match(packet.packet_id, /^[a-f0-9]{64}$/);
});

test('identical observation input produces an identical packet id', async () => {
  const first = await createPacket(structuredClone(OBSERVATION));
  const second = await createPacket(structuredClone(OBSERVATION));

  assert.equal(first.packet_id, second.packet_id);
  assert.deepEqual(first, second);
});

test('canonicalize recursively sorts object keys without sorting arrays', () => {
  assert.equal(
    canonicalize({ z: 1, nested: { z: 2, a: 1 }, list: [{ z: 2, a: 1 }] }),
    '{"list":[{"a":1,"z":2}],"nested":{"a":1,"z":2},"z":1}',
  );
});

test('computeFingerprint is independent of object insertion order', async () => {
  const first = await computeFingerprint({ b: 2, a: { d: 4, c: 3 } });
  const second = await computeFingerprint({ a: { c: 3, d: 4 }, b: 2 });

  assert.equal(first, second);
});

test('serialize and deserialize preserve the complete packet', async () => {
  const packet = await createPacket(OBSERVATION);
  const serialized = serializePacket(packet);

  assert.deepEqual(deserializePacket(serialized), packet);
  assert.equal(serialized, `${JSON.stringify(packet, null, 2)}\n`);
});

test('replay validates an unchanged packet', async () => {
  const packet = await createPacket(OBSERVATION);
  const replay = await replayPacket(serializePacket(packet));

  assert.equal(replay.valid, true);
  assert.deepEqual(replay.errors, []);
  assert.deepEqual(replay.packet, packet);
});

test('replay rejects a modified packet', async () => {
  const packet = await createPacket(OBSERVATION);
  packet.properties.magnitude = 9.9;
  const replay = await replayPacket(serializePacket(packet));

  assert.equal(replay.valid, false);
  assert.match(replay.errors.join(' '), /fingerprint mismatch/i);
  assert.equal(await validateFingerprint(packet), false);
});

test('createPacket rejects invented integrity assessments', async () => {
  await assert.rejects(
    createPacket({ ...OBSERVATION, confidence: 0.95 }),
    /confidence must be "unassessed"/i,
  );
});

test('createPacket rejects missing numeric evidence instead of coercing it to zero', async () => {
  await assert.rejects(
    createPacket({
      ...OBSERVATION,
      location: { ...OBSERVATION.location, latitude: null },
    }),
    /location\.latitude must be a finite number/i,
  );
});

test('createPacket rejects implementation-dependent timestamp strings', async () => {
  await assert.rejects(
    createPacket({ ...OBSERVATION, observedAt: 'August 25, 2026 14:32 UTC' }),
    /observedAt must be an ISO 8601 UTC timestamp/i,
  );
});
