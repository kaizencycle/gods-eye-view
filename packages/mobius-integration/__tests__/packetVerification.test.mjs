import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attachPacketVerification } from '../packetVerification.js';

function createAdapter() {
  let listener = null;
  return {
    subscribePackets(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    emit(packet) {
      listener?.(packet);
    },
  };
}

test('a local packet remains pending when Terminal verification is disabled', async () => {
  const adapter = createAdapter();
  const verification = attachPacketVerification({
    mobiusAdapter: adapter,
    bridge: {
      canVerify: () => false,
    },
  });

  adapter.emit({ packet_id: 'packet-local' });
  await verification.whenIdle();

  assert.deepEqual(verification.getState(), {
    status: 'pending',
    packetId: 'packet-local',
    verdict: null,
    error: null,
  });
});

test('configured verification publishes the real Terminal verdict', async () => {
  const adapter = createAdapter();
  const verification = attachPacketVerification({
    mobiusAdapter: adapter,
    bridge: {
      canVerify: () => true,
      verifyObservation: async () => ({
        ok: true,
        accepted: false,
        packet_id: 'packet-verified',
        confidence_new: null,
        witnesses: [],
      }),
    },
  });
  const states = [];
  verification.subscribe((state) => states.push(state));

  adapter.emit({ packet_id: 'packet-verified' });
  await verification.whenIdle();

  assert.equal(states.some((state) => state.status === 'verifying'), true);
  assert.equal(verification.getState().status, 'evaluated');
  assert.equal(verification.getState().verdict.accepted, false);
});

test('destroy unsubscribes from packet capture', async () => {
  const adapter = createAdapter();
  const verification = attachPacketVerification({
    mobiusAdapter: adapter,
    bridge: { canVerify: () => false },
  });
  verification.destroy();

  adapter.emit({ packet_id: 'ignored' });
  await verification.whenIdle();

  assert.equal(verification.getState().packetId, null);
});
