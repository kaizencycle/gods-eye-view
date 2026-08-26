import { computeFingerprint } from '../hashing/computeFingerprint.js';
import {
  assertPacket,
  assertPacketBody,
  EPICON_PACKET_VERSION,
  EPICON_RENDERER,
  UNASSESSED,
} from '../schema/validation.js';

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalTimestamp(value, field) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError(`${field} must be a valid timestamp`);
    return value.toISOString();
  }
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new TypeError(`${field} must be an ISO 8601 UTC timestamp`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} must be a valid timestamp`);
  return date.toISOString();
}

function unassessed(value, field) {
  if (value !== undefined && value !== UNASSESSED) {
    throw new TypeError(`${field} must be "unassessed" in EPICON v0.1`);
  }
  return UNASSESSED;
}

/**
 * Transform one accepted, clicked earthquake observation into EPICON v0.1.
 */
export async function createPacket(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('Observation must be an object');
  }
  if (observation.eventType !== 'earthquake') {
    throw new TypeError('EPICON v0.1 supports earthquake observations only');
  }

  const sourceId = requiredText(observation.eventId, 'eventId');
  const sourceTimestamp = observation.properties?.sourceTimestamp;
  const properties = {
    magnitude: finiteNumber(observation.properties?.magnitude, 'properties.magnitude'),
    source_id: sourceId,
  };
  const place = typeof observation.properties?.place === 'string'
    ? observation.properties.place.trim()
    : '';
  if (place) properties.place = place;
  if (sourceTimestamp !== undefined && sourceTimestamp !== null) {
    properties.source_timestamp = canonicalTimestamp(
      sourceTimestamp,
      'properties.sourceTimestamp',
    );
  }

  const body = {
    packet_version: EPICON_PACKET_VERSION,
    event_id: sourceId.startsWith('usgs:') ? sourceId : `usgs:${sourceId}`,
    event_type: 'earthquake',
    timestamp: canonicalTimestamp(observation.observedAt, 'observedAt'),
    source: requiredText(observation.source, 'source'),
    renderer: EPICON_RENDERER,
    location: {
      latitude: finiteNumber(observation.location?.latitude, 'location.latitude'),
      longitude: finiteNumber(observation.location?.longitude, 'location.longitude'),
      depth_km: finiteNumber(observation.location?.depthKm, 'location.depthKm'),
    },
    properties,
    freshness: unassessed(observation.freshness, 'freshness'),
    confidence: unassessed(observation.confidence, 'confidence'),
  };
  assertPacketBody(body);
  const fingerprint = await computeFingerprint(body);
  return assertPacket({
    ...body,
    packet_id: fingerprint,
    fingerprint,
  });
}
