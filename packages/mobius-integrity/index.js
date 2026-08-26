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
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError(`${field} must be finite`);
  return Object.is(numeric, -0) ? 0 : numeric;
}

export function normalizeEarthquakeRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('Earthquake record must be an object');
  }
  const id = String(record.id || '').trim();
  if (!id) throw new TypeError('Earthquake record id is required');
  const place = String(record.place ?? '').trim();
  return {
    id,
    magnitude: finiteNumber(record.magnitude, 'magnitude'),
    depthKm: finiteNumber(record.depthKm, 'depthKm'),
    lat: finiteNumber(record.lat, 'lat'),
    lon: finiteNumber(record.lon, 'lon'),
    timeMs: finiteNumber(record.timeMs, 'timeMs'),
    place: place || null,
  };
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
  leftClickEventType,
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

  const packetStore = createLocalPacketStore(storage);
  const acceptedRecords = new Map();
  let hasAcceptedSnapshot = false;
  let disposed = false;
  let pendingCapture = Promise.resolve(null);

  const readCurrentRecords = () => {
    const records = source.getRecords();
    return Array.isArray(records) ? records.map(normalizeEarthquakeRecord) : [];
  };

  const snapshotAcceptedRecords = () => {
    const records = readCurrentRecords();
    const next = new Map();
    for (const record of records) next.set(record.id, recordFingerprint(record));
    acceptedRecords.clear();
    for (const [id, fingerprint] of next) acceptedRecords.set(id, fingerprint);
    hasAcceptedSnapshot = true;
  };

  const unsubscribe = dataManager.subscribe((change) => {
    if (disposed || change?.layerId !== EARTHQUAKE_LAYER_ID) return;
    if (change.type === 'visibility' && change.enabled === false) {
      acceptedRecords.clear();
      hasAcceptedSnapshot = false;
      return;
    }
    const firstSuccessfulVisibility = change.type === 'visibility'
      && change.enabled === true
      && !hasAcceptedSnapshot;
    if (firstSuccessfulVisibility || change.type === 'refresh') {
      try {
        snapshotAcceptedRecords();
      } catch (error) {
        logger.warn?.(`[EPICON] Could not snapshot accepted earthquakes: ${error.message}`);
      }
    }
  });

  if (dataManager.isEnabled?.(EARTHQUAKE_LAYER_ID)) snapshotAcceptedRecords();

  const releasePickOwnership = typeof registerPickOwnership === 'function'
    ? registerPickOwnership((pickedId) => pickedId.startsWith(EARTHQUAKE_PICK_PREFIX))
    : null;

  const handler = createClickHandler(viewer.scene.canvas);
  if (!handler || typeof handler.setInputAction !== 'function') {
    unsubscribe?.();
    releasePickOwnership?.();
    throw new TypeError('Mobius click-handler factory returned an invalid handler');
  }

  const captureClick = async (click) => {
    if (disposed) return null;
    const picked = viewer.scene.pick(click?.position);
    const pickedId = resolvePickedId(picked);
    if (!pickedId?.startsWith(EARTHQUAKE_PICK_PREFIX)) return null;
    const eventId = pickedId.slice(EARTHQUAKE_PICK_PREFIX.length);
    const current = readCurrentRecords().find((record) => record.id === eventId);
    if (!current || acceptedRecords.get(eventId) !== recordFingerprint(current)) {
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
    packetStore.save(packet);
    logger.info?.(`[EPICON] Saved packet ${packet.packet_id}`);
    return packet;
  };

  handler.setInputAction((click) => {
    pendingCapture = pendingCapture
      .then(() => captureClick(click))
      .catch((error) => {
        logger.warn?.(`[EPICON] Packet capture failed: ${error.message}`);
        return null;
      });
  }, leftClickEventType);

  return Object.freeze({
    listPacketIds: () => packetStore.listPacketIds(),
    readPacket: (packetId) => packetStore.read(packetId),
    readPacketJson: (packetId) => packetStore.readJson(packetId),
    replay: (packetId) => replayPacket(packetStore.readJson(packetId) || ''),
    whenIdle: () => pendingCapture,
    dispose() {
      if (disposed) return;
      disposed = true;
      acceptedRecords.clear();
      hasAcceptedSnapshot = false;
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
