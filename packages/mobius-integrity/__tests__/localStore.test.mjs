import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPacket } from '../packet/createPacket.js';
import {
  createLocalPacketStore,
  EPICON_PACKET_INDEX_KEY,
} from '../replay/localPacketStore.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const observation = {
  eventId: 'us7000store',
  eventType: 'earthquake',
  observedAt: '2026-08-25T15:00:00Z',
  source: 'USGS',
  location: { latitude: 1, longitude: 2, depthKm: 3 },
  properties: { magnitude: 4.5, place: 'Store fixture' },
};

test('local packet store saves and reads packet JSON by packet id', async () => {
  const storage = createMemoryStorage();
  const store = createLocalPacketStore(storage);
  const packet = await createPacket(observation);

  await store.save(packet);

  assert.deepEqual(store.read(packet.packet_id), packet);
  assert.deepEqual(store.listPacketIds(), [packet.packet_id]);
  assert.match(storage.getItem(EPICON_PACKET_INDEX_KEY), /^\["/);
});

test('saving the same packet is idempotent', async () => {
  const store = createLocalPacketStore(createMemoryStorage());
  const packet = await createPacket(observation);

  await store.save(packet);
  await store.save(packet);

  assert.deepEqual(store.listPacketIds(), [packet.packet_id]);
});

test('local packet store fails closed on malformed index JSON', () => {
  const storage = createMemoryStorage();
  storage.setItem(EPICON_PACKET_INDEX_KEY, '{not-json');
  const store = createLocalPacketStore(storage);

  assert.deepEqual(store.listPacketIds(), []);
});

test('local packet store uses an in-memory fallback outside a browser', async () => {
  const store = createLocalPacketStore();
  const packet = await createPacket(observation);

  await store.save(packet);

  assert.deepEqual(store.read(packet.packet_id), packet);
});

test('local packet store refuses a conflicting existing packet body', async () => {
  const storage = createMemoryStorage();
  const store = createLocalPacketStore(storage);
  const packet = await createPacket(observation);
  storage.setItem(
    `epicon:v0.1:packet:${packet.packet_id}`,
    JSON.stringify(packet),
  );

  await assert.rejects(store.save(packet), /conflicting EPICON packet/i);
});

test('local packet store falls back when a browser write fails', async () => {
  let writeCount = 0;
  const storage = {
    getItem: () => null,
    setItem() {
      writeCount++;
      if (writeCount === 2) throw new Error('quota denied');
    },
    removeItem() {},
  };
  const store = createLocalPacketStore(storage);
  const packet = await createPacket(observation);

  await store.save(packet);

  assert.deepEqual(store.read(packet.packet_id), packet);
  assert.deepEqual(store.listPacketIds(), [packet.packet_id]);
});

test('write fallback keeps earlier indexed packets readable', async () => {
  const values = new Map();
  let failIndexWrite = false;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (failIndexWrite && key === EPICON_PACKET_INDEX_KEY) {
        throw new Error('index quota denied');
      }
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
  };
  const store = createLocalPacketStore(storage);
  const first = await createPacket(observation);
  const second = await createPacket({
    ...observation,
    observedAt: '2026-08-25T15:01:00Z',
  });
  await store.save(first);
  failIndexWrite = true;

  await store.save(second);

  assert.deepEqual(store.listPacketIds(), [first.packet_id, second.packet_id]);
  assert.deepEqual(store.read(first.packet_id), first);
  assert.deepEqual(store.read(second.packet_id), second);
});
