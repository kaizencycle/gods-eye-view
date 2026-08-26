import {
  canonicalize,
  computeFingerprint,
} from './hashing/computeFingerprint.js';
import { createPacket } from './packet/createPacket.js';
import { replayPacket } from './packet/replayPacket.js';
import { serializePacket } from './packet/serializePacket.js';
import { createLocalPacketStore } from './replay/localPacketStore.js';

const EARTHQUAKE_LAYER_ID = 'earthquakes';
const EARTHQUAKE_PICK_PREFIX = 'earthquake:';

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

export function normalizeEarthquakeRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('Earthquake record must be an object');
  }
  const id = String(record.id || '').trim();
  if (!id) throw new TypeError('Earthquake record id is required');
  const place = String(record.place ?? '').trim();
  const normalized = {
    id,
    magnitude: finiteNumber(record.magnitude, 'magnitude'),
    depthKm: finiteNumber(record.depthKm, 'depthKm'),
    lat: finiteNumber(record.lat, 'lat'),
    lon: finiteNumber(record.lon, 'lon'),
    timeMs: finiteNumber(record.timeMs, 'timeMs'),
    place: place || null,
  };
  if (!Number.isFinite(new Date(normalized.timeMs).getTime())) {
    throw new TypeError('timeMs must identify a valid timestamp');
  }
  return normalized;
}

function recordFingerprint(record) {
  return canonicalize(normalizeEarthquakeRecord(record));
}

function resolvePickedId(picked) {
  const candidate = picked?.id ?? picked?.primitive?.id;
  if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  if (typeof candidate?.id === 'string' || typeof candidate?.id === 'number') {
    return String(candidate.id);
  }
  return null;
}

function resolveEarthquakeRecord(records, pickedEventId) {
  const direct = records.find((record) => record?.id === pickedEventId);
  if (direct) return direct;
  const fallback = /^event-(\d+)$/.exec(pickedEventId);
  if (!fallback) return null;
  const index = Number(fallback[1]) - 1;
  return Number.isSafeInteger(index) && index >= 0 ? records[index] || null : null;
}

function packetObservation(record, observedAt, sourceName) {
  return {
    eventId: record.id,
    eventType: 'earthquake',
    observedAt,
    source: sourceName,
    location: {
      latitude: record.lat,
      longitude: record.lon,
      depthKm: record.depthKm,
    },
    properties: {
      magnitude: record.magnitude,
      place: record.place,
      sourceTimestamp: new Date(record.timeMs).toISOString(),
    },
  };
}

/**
 * Attach the invisible earthquake → EPICON developer proof.
 *
 * The adapter snapshots records only after manager-confirmed successful
 * visibility/refresh events. A click is accepted only when the current full
 * record exactly matches that snapshot.
 */
export function attachMobiusAdapter({
  viewer,
  dataManager,
  source,
  createClickHandler,
  bindClickHandler,
  registerPickOwnership = null,
  storage,
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!viewer?.scene?.canvas || typeof viewer.scene.pick !== 'function') {
    throw new TypeError('Mobius adapter requires a pick-capable viewer');
  }
  if (!dataManager || typeof dataManager.subscribe !== 'function') {
    throw new TypeError('Mobius adapter requires DataLayerManager.subscribe()');
  }
  if (!source || typeof source.getRecords !== 'function') {
    throw new TypeError('Mobius adapter requires an earthquake record reader');
  }
  if (typeof createClickHandler !== 'function') {
    throw new TypeError('Mobius adapter requires a click-handler factory');
  }
  if (typeof bindClickHandler !== 'function') {
    throw new TypeError('Mobius adapter requires the shared click-gesture binder');
  }

  const packetStore = createLocalPacketStore(storage);
  const acceptedRecords = new Map();
  const packetListeners = new Set();
  let enableTransitionPending = false;
  let disposed = false;
  let pendingCapture = Promise.resolve(null);

  const notifyPacketListeners = (packet) => {
    for (const listener of packetListeners) {
      try {
        const result = listener(structuredClone(packet));
        Promise.resolve(result).catch((error) => {
          logger.warn?.(`[EPICON] Packet listener failed: ${error.message}`);
        });
      } catch (error) {
        logger.warn?.(`[EPICON] Packet listener failed: ${error.message}`);
      }
    }
  };

  const readCurrentRecords = () => {
    const records = source.getRecords();
    if (!Array.isArray(records)) return [];
    return records.map((record) => {
      try {
        return normalizeEarthquakeRecord(record);
      } catch (error) {
        logger.warn?.(
          `[EPICON] Ignored incomplete earthquake ${record?.id || 'unknown'}: ${error.message}`,
        );
        return null;
      }
    });
  };

  const snapshotAcceptedRecords = () => {
    const records = readCurrentRecords();
    const next = new Map();
    for (const record of records) {
      if (record) next.set(record.id, recordFingerprint(record));
    }
    acceptedRecords.clear();
    for (const [id, fingerprint] of next) acceptedRecords.set(id, fingerprint);
  };

  const unsubscribe = dataManager.subscribe((change) => {
    if (disposed || change?.layerId !== EARTHQUAKE_LAYER_ID) return;
    if (change.type === 'visibility-transition') {
      enableTransitionPending = change.lifecycleState === 'enabling';
      return;
    }
    if (change.type === 'visibility' && change.enabled === false) {
      acceptedRecords.clear();
      enableTransitionPending = false;
      return;
    }
    const completedSuccessfulEnable = change.type === 'visibility'
      && change.enabled === true
      && enableTransitionPending;
    if (completedSuccessfulEnable || change.type === 'refresh') {
      try {
        snapshotAcceptedRecords();
      } catch (error) {
        logger.warn?.(`[EPICON] Could not snapshot accepted earthquakes: ${error.message}`);
      }
    }
    if (change.type === 'visibility' || change.type === 'visibility-failed'
      || change.type === 'visibility-cancelled' || change.type === 'visibility-blocked') {
      enableTransitionPending = false;
    }
  });

  let handler;
  try {
    handler = createClickHandler(viewer.scene.canvas);
  } catch (error) {
    unsubscribe?.();
    throw error;
  }
  if (!handler || typeof handler !== 'object') {
    unsubscribe?.();
    throw new TypeError('Mobius click-handler factory returned an invalid handler');
  }
  let releasePickOwnership = null;
  try {
    releasePickOwnership = typeof registerPickOwnership === 'function'
      ? registerPickOwnership((pickedId) => pickedId.startsWith(EARTHQUAKE_PICK_PREFIX))
      : null;
  } catch (error) {
    unsubscribe?.();
    handler.destroy?.();
    throw error;
  }

  const captureClick = async (click) => {
    if (disposed) return null;
    const picked = viewer.scene.pick(click?.position);
    const pickedId = resolvePickedId(picked);
    if (!pickedId?.startsWith(EARTHQUAKE_PICK_PREFIX)) return null;
    const eventId = pickedId.slice(EARTHQUAKE_PICK_PREFIX.length);
    const current = resolveEarthquakeRecord(readCurrentRecords(), eventId);
    if (!current || acceptedRecords.get(current.id) !== recordFingerprint(current)) {
      logger.warn?.(
        `[EPICON] Earthquake ${eventId} is not in the last accepted snapshot; packet skipped`,
      );
      return null;
    }
    const observedAt = now();
    const packet = await createPacket(packetObservation(
      current,
      observedAt instanceof Date ? observedAt.toISOString() : observedAt,
      source.name || 'USGS',
    ));
    await packetStore.save(packet);
    notifyPacketListeners(packet);
    logger.info?.(`[EPICON] Saved packet ${packet.packet_id}`);
    return packet;
  };

  try {
    bindClickHandler(handler, (click) => {
      pendingCapture = pendingCapture
        .then(() => captureClick(click))
        .catch((error) => {
          logger.warn?.(`[EPICON] Packet capture failed: ${error.message}`);
          return null;
        });
    });
  } catch (error) {
    unsubscribe?.();
    releasePickOwnership?.();
    handler.destroy?.();
    throw error;
  }

  return Object.freeze({
    listPacketIds: () => packetStore.listPacketIds(),
    readPacket: (packetId) => packetStore.read(packetId),
    readPacketJson: (packetId) => packetStore.readJson(packetId),
    subscribePackets(listener) {
      if (typeof listener !== 'function') return () => {};
      packetListeners.add(listener);
      return () => packetListeners.delete(listener);
    },
    async replay(packetId) {
      const packet = await packetStore.read(packetId);
      if (!packet) {
        return {
          packet: null,
          valid: false,
          errors: ['Stored packet failed fingerprint or storage-key validation'],
        };
      }
      return replayPacket(serializePacket(packet));
    },
    whenIdle: () => pendingCapture,
    dispose() {
      if (disposed) return;
      disposed = true;
      acceptedRecords.clear();
      packetListeners.clear();
      enableTransitionPending = false;
      unsubscribe?.();
      releasePickOwnership?.();
      handler.destroy?.();
    },
  });
}

export {
  computeFingerprint,
  createPacket,
  replayPacket,
  serializePacket,
};
