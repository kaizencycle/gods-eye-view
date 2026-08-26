import { assertPacket } from '../schema/validation.js';
import { validateFingerprint } from '../hashing/computeFingerprint.js';
import {
  deserializePacket,
  serializePacket,
} from '../packet/serializePacket.js';

export const EPICON_PACKET_INDEX_KEY = 'epicon:v0.1:packet-index';
const EPICON_PACKET_KEY_PREFIX = 'epicon:v0.1:packet:';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage || createMemoryStorage();
  } catch {
    return createMemoryStorage();
  }
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('EPICON local packet store requires a Storage-compatible object');
  }
  return storage;
}

function packetStorageKey(packetId) {
  return `${EPICON_PACKET_KEY_PREFIX}${packetId}`;
}

/** Create a local JSON packet repository backed by browser localStorage. */
export function createLocalPacketStore(storage = safeLocalStorage()) {
  let target = requireStorage(storage);
  const memory = createMemoryStorage();

  const useMemory = () => {
    target = memory;
  };

  const getItem = (key) => {
    try {
      return target.getItem(key);
    } catch {
      useMemory();
      return target.getItem(key);
    }
  };

  const readIndex = () => {
    try {
      const parsed = JSON.parse(getItem(EPICON_PACKET_INDEX_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
    } catch {
      return [];
    }
  };

  return Object.freeze({
    async save(packet) {
      assertPacket(packet);
      if (!(await validateFingerprint(packet))) {
        throw new TypeError('Cannot save an EPICON packet with an invalid fingerprint');
      }
      const key = packetStorageKey(packet.packet_id);
      const serialized = serializePacket(packet);
      const existing = getItem(key);
      if (existing !== null && existing !== serialized) {
        throw new Error(`Conflicting EPICON packet already exists for ${packet.packet_id}`);
      }
      const ids = readIndex();
      if (!ids.includes(packet.packet_id)) ids.push(packet.packet_id);
      const serializedIndex = JSON.stringify(ids);
      const fallbackPackets = new Map();
      const writeTarget = target;
      for (const id of ids) {
        const stored = id === packet.packet_id
          ? serialized
          : getItem(packetStorageKey(id));
        if (stored !== null) fallbackPackets.set(id, stored);
      }
      if (target !== writeTarget) {
        for (const [id, stored] of fallbackPackets) {
          target.setItem(packetStorageKey(id), stored);
        }
        target.setItem(
          EPICON_PACKET_INDEX_KEY,
          JSON.stringify([...fallbackPackets.keys()]),
        );
        return packet.packet_id;
      }
      try {
        target.setItem(key, serialized);
        target.setItem(EPICON_PACKET_INDEX_KEY, serializedIndex);
      } catch {
        const failedTarget = target;
        if (existing === null) {
          try {
            failedTarget.removeItem?.(key);
          } catch {
            // Best-effort cleanup of a packet written before its index failed.
          }
        }
        useMemory();
        for (const [id, stored] of fallbackPackets) {
          target.setItem(packetStorageKey(id), stored);
        }
        target.setItem(
          EPICON_PACKET_INDEX_KEY,
          JSON.stringify([...fallbackPackets.keys()]),
        );
      }
      return packet.packet_id;
    },

    async read(packetId) {
      const requestedId = String(packetId || '');
      const serialized = getItem(packetStorageKey(requestedId));
      if (!serialized) return null;
      try {
        const packet = assertPacket(deserializePacket(serialized));
        if (packet.packet_id !== requestedId) return null;
        return await validateFingerprint(packet) ? packet : null;
      } catch {
        return null;
      }
    },

    readJson(packetId) {
      return getItem(packetStorageKey(String(packetId || '')));
    },

    listPacketIds() {
      return [...readIndex()];
    },
  });
}
