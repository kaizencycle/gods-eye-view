import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attachMobiusAdapter } from '../index.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function createManager(enabled = false) {
  let listener = null;
  return {
    isEnabled: () => enabled,
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    emit(change) {
      listener?.(change);
    },
  };
}

function createClickHarness() {
  let click = null;
  let destroyed = false;
  return {
    factory() {
      return {
        setInputAction(callback) {
          click = callback;
        },
        destroy() {
          destroyed = true;
        },
      };
    },
    click(position = { x: 10, y: 20 }) {
      click?.({ position });
    },
    get destroyed() {
      return destroyed;
    },
  };
}

const acceptedRecord = Object.freeze({
  id: 'us7000adapter',
  magnitude: 5.1,
  depthKm: 7.25,
  lat: 37.75,
  lon: -122.45,
  timeMs: Date.parse('2026-08-25T14:30:00Z'),
  place: 'Adapter fixture',
});

function createAdapterFixture({ managerEnabled = false } = {}) {
  const manager = createManager(managerEnabled);
  const clicks = createClickHarness();
  const storage = createMemoryStorage();
  let records = [structuredClone(acceptedRecord)];
  let pickedId = `earthquake:${acceptedRecord.id}`;
  const warnings = [];
  const viewer = {
    scene: {
      canvas: {},
      pick: () => ({ id: { id: pickedId } }),
    },
  };
  const adapter = attachMobiusAdapter({
    viewer,
    dataManager: manager,
    source: {
      getRecords: () => structuredClone(records),
    },
    createClickHandler: () => clicks.factory(),
    bindClickHandler: (handler, onClick) => handler.setInputAction(onClick),
    storage,
    now: () => new Date('2026-08-25T14:32:00Z'),
    logger: {
      info() {},
      warn: (message) => warnings.push(String(message)),
    },
  });
  return {
    adapter,
    clicks,
    manager,
    storage,
    warnings,
    setRecords(next) {
      records = structuredClone(next);
    },
    setPickedId(next) {
      pickedId = next;
    },
  };
}

function emitSuccessfulEnable(manager) {
  manager.emit({
    type: 'visibility-transition',
    layerId: 'earthquakes',
    enabled: true,
    lifecycleState: 'enabling',
  });
  manager.emit({
    type: 'visibility',
    layerId: 'earthquakes',
    enabled: true,
  });
}

test('successful earthquake visibility snapshots records for click capture', async () => {
  const fixture = createAdapterFixture();
  emitSuccessfulEnable(fixture.manager);

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  const packetIds = fixture.adapter.listPacketIds();
  assert.equal(packetIds.length, 1);
  const packet = await fixture.adapter.readPacket(packetIds[0]);
  assert.equal(packet.event_id, `usgs:${acceptedRecord.id}`);
  assert.equal(packet.properties.magnitude, acceptedRecord.magnitude);
  assert.equal(packet.location.latitude, acceptedRecord.lat);
});

test('attaching to an enabled layer does not trust records without a success event', async () => {
  const fixture = createAdapterFixture({ managerEnabled: true });
  fixture.manager.emit({
    type: 'visibility',
    layerId: 'earthquakes',
    enabled: true,
  });

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  assert.deepEqual(fixture.adapter.listPacketIds(), []);
});

test('fallback event-N picks resolve to index-based analyst identities', async () => {
  const fixture = createAdapterFixture();
  fixture.setRecords([{ ...acceptedRecord, id: 'QUAKE-0000' }]);
  fixture.setPickedId('earthquake:event-1');
  emitSuccessfulEnable(fixture.manager);

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  const [packetId] = fixture.adapter.listPacketIds();
  const packet = await fixture.adapter.readPacket(packetId);
  assert.equal(packet.event_id, 'usgs:QUAKE-0000');
});

test('an incomplete sibling does not block a valid accepted earthquake', async () => {
  const fixture = createAdapterFixture();
  fixture.setRecords([
    { ...acceptedRecord, id: 'incomplete', magnitude: null },
    acceptedRecord,
  ]);
  fixture.setPickedId(`earthquake:${acceptedRecord.id}`);
  emitSuccessfulEnable(fixture.manager);

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  assert.equal(fixture.adapter.listPacketIds().length, 1);
  assert.match(fixture.warnings.join(' '), /ignored incomplete earthquake incomplete/i);
});

test('developer replay binds a packet to its requested storage key', async () => {
  const fixture = createAdapterFixture();
  emitSuccessfulEnable(fixture.manager);
  fixture.clicks.click();
  await fixture.adapter.whenIdle();
  const [packetId] = fixture.adapter.listPacketIds();
  const wrongKey = 'b'.repeat(64);
  fixture.storage.setItem(
    `epicon:v0.1:packet:${wrongKey}`,
    fixture.adapter.readPacketJson(packetId),
  );

  const replay = await fixture.adapter.replay(wrongKey);

  assert.equal(replay.valid, false);
  assert.match(replay.errors.join(' '), /storage-key validation/i);
});

test('packet subscribers receive a detached packet after local persistence', async () => {
  const fixture = createAdapterFixture();
  const packets = [];
  const unsubscribe = fixture.adapter.subscribePackets((packet) => {
    packets.push(packet);
    packet.source = 'mutated-listener-copy';
  });
  emitSuccessfulEnable(fixture.manager);

  fixture.clicks.click();
  await fixture.adapter.whenIdle();
  unsubscribe();

  const [packetId] = fixture.adapter.listPacketIds();
  assert.equal(packets.length, 1);
  assert.equal((await fixture.adapter.readPacket(packetId)).source, 'USGS');
});

test('failed refresh cannot promote a partial displayed record', async () => {
  const fixture = createAdapterFixture();
  emitSuccessfulEnable(fixture.manager);
  fixture.setRecords([{ ...acceptedRecord, magnitude: 8.8 }]);
  fixture.manager.emit({
    type: 'refresh-failed',
    layerId: 'earthquakes',
    enabled: true,
  });
  // An idempotent setEnabled(true) emits visibility without running update;
  // it must not promote the failed partial collection.
  fixture.manager.emit({
    type: 'visibility',
    layerId: 'earthquakes',
    enabled: true,
  });

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  assert.deepEqual(fixture.adapter.listPacketIds(), []);
  assert.match(fixture.warnings.join(' '), /not in the last accepted snapshot/i);
});

test('successful refresh advances the accepted snapshot', async () => {
  const fixture = createAdapterFixture();
  emitSuccessfulEnable(fixture.manager);
  fixture.setRecords([{ ...acceptedRecord, magnitude: 6.3 }]);
  fixture.manager.emit({
    type: 'refresh',
    layerId: 'earthquakes',
    enabled: true,
  });

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  const [packetId] = fixture.adapter.listPacketIds();
  assert.equal((await fixture.adapter.readPacket(packetId)).properties.magnitude, 6.3);
});

test('non-earthquake picks are ignored', async () => {
  const fixture = createAdapterFixture();
  emitSuccessfulEnable(fixture.manager);
  fixture.setPickedId('flight:abc123');

  fixture.clicks.click();
  await fixture.adapter.whenIdle();

  assert.deepEqual(fixture.adapter.listPacketIds(), []);
});

test('dispose removes manager and click resources', () => {
  const fixture = createAdapterFixture();
  fixture.adapter.dispose();

  assert.equal(fixture.clicks.destroyed, true);
  fixture.manager.emit({
    type: 'visibility',
    layerId: 'earthquakes',
    enabled: true,
  });
});
