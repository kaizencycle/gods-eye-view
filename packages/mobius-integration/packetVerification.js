const INITIAL_STATE = Object.freeze({
  status: 'idle',
  packetId: null,
  verdict: null,
  error: null,
});

function copyState(state) {
  return {
    status: state.status,
    packetId: state.packetId,
    verdict: state.verdict ? JSON.parse(JSON.stringify(state.verdict)) : null,
    error: state.error,
  };
}

/** Connect locally generated EPICON packets to an optional Terminal proxy. */
export function attachPacketVerification({
  mobiusAdapter,
  bridge,
  logger = console,
} = {}) {
  if (!mobiusAdapter || typeof mobiusAdapter.subscribePackets !== 'function') {
    throw new TypeError('Packet verification requires Mobius packet subscription');
  }
  if (!bridge || typeof bridge.canVerify !== 'function') {
    throw new TypeError('Packet verification requires a Terminal bridge');
  }

  const listeners = new Set();
  let state = INITIAL_STATE;
  let generation = 0;
  let pending = Promise.resolve(null);
  let destroyed = false;

  const notify = () => {
    const snapshot = copyState(state);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Presentation listeners never own packet verification.
      }
    }
  };

  const setState = (next) => {
    state = Object.freeze(next);
    notify();
  };

  const handlePacket = async (packet, packetGeneration) => {
    if (destroyed || packetGeneration !== generation) return null;
    if (!bridge.canVerify()) {
      setState({
        status: 'pending',
        packetId: packet.packet_id,
        verdict: null,
        error: null,
      });
      return null;
    }

    setState({
      status: 'verifying',
      packetId: packet.packet_id,
      verdict: null,
      error: null,
    });
    try {
      const verdict = await bridge.verifyObservation(packet);
      if (destroyed || packetGeneration !== generation) return null;
      setState({
        status: 'evaluated',
        packetId: packet.packet_id,
        verdict,
        error: null,
      });
      return verdict;
    } catch (error) {
      if (destroyed || packetGeneration !== generation) return null;
      const message = String(error?.message || error);
      setState({
        status: 'failed',
        packetId: packet.packet_id,
        verdict: null,
        error: message,
      });
      logger.warn?.(`[Terminal] Observation verification failed: ${message}`);
      return null;
    }
  };

  const unsubscribePackets = mobiusAdapter.subscribePackets((packet) => {
    const packetGeneration = ++generation;
    pending = handlePacket(packet, packetGeneration);
  });

  return Object.freeze({
    getState: () => copyState(state),
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(copyState(state));
      return () => listeners.delete(listener);
    },
    whenIdle: () => pending,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      unsubscribePackets?.();
      listeners.clear();
    },
  });
}
