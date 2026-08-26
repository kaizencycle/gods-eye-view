import { assertPacket } from '../schema/validation.js';
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

function readIndex(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(EPICON_PACKET_INDEX_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
  } catch {
    return [];
  }
}

/** Create a local JSON packet repository backed by browser localStorage. */
export function createLocalPacketStore(storage = safeLocalStorage()) {
  const target = requireStorage(storage);
  return Object.freeze({
    save(packet) {
      assertPacket(packet);
      target.setItem(packetStorageKey(packet.packet_id), serializePacket(packet));
      const ids = readIndex(target);
      if (!ids.includes(packet.packet_id)) {
        ids.push(packet.packet_id);
        target.setItem(EPICON_PACKET_INDEX_KEY, JSON.stringify(ids));
      }
      return packet.packet_id;
    },

    read(packetId) {
      const serialized = target.getItem(packetStorageKey(String(packetId || '')));
      if (!serialized) return null;
      try {
        return assertPacket(deserializePacket(serialized));
      } catch {
        return null;
      }
    },

    readJson(packetId) {
      return target.getItem(packetStorageKey(String(packetId || '')));
    },

    listPacketIds() {
      return [...readIndex(target)];
    },
  });
}
