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

  store.save(packet);

  assert.deepEqual(store.read(packet.packet_id), packet);
  assert.deepEqual(store.listPacketIds(), [packet.packet_id]);
  assert.match(storage.getItem(EPICON_PACKET_INDEX_KEY), /^\["/);
});

test('saving the same packet is idempotent', async () => {
  const store = createLocalPacketStore(createMemoryStorage());
  const packet = await createPacket(observation);

  store.save(packet);
  store.save(packet);

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

  store.save(packet);

  assert.deepEqual(store.read(packet.packet_id), packet);
});
