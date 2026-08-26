export const EPICON_PACKET_VERSION = '0.1';
export const EPICON_RENDERER = 'gods-eye-view';
export const UNASSESSED = 'unassessed';

const SHA_256_HEX = /^[a-f0-9]{64}$/;
const TOP_LEVEL_FIELDS = new Set([
  'packet_id',
  'fingerprint',
  'packet_version',
  'event_id',
  'event_type',
  'timestamp',
  'source',
  'renderer',
  'location',
  'properties',
  'freshness',
  'confidence',
]);
const LOCATION_FIELDS = new Set(['latitude', 'longitude', 'depth_km']);
const PROPERTY_FIELDS = new Set([
  'magnitude',
  'source_id',
  'place',
  'source_timestamp',
]);

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isFiniteInRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function rejectUnknownFields(value, allowed, path, errors) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

export function validatePacketBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['Packet body must be an object'];
  }
  rejectUnknownFields(body, TOP_LEVEL_FIELDS, 'packet', errors);
  if (body.packet_version !== EPICON_PACKET_VERSION) errors.push('packet_version must be "0.1"');
  if (typeof body.event_id !== 'string' || !body.event_id) errors.push('event_id is required');
  if (body.event_type !== 'earthquake') errors.push('event_type must be "earthquake"');
  if (!isIsoTimestamp(body.timestamp)) errors.push('timestamp must be a canonical ISO 8601 timestamp');
  if (typeof body.source !== 'string' || !body.source) errors.push('source is required');
  if (body.renderer !== EPICON_RENDERER) errors.push('renderer must be "gods-eye-view"');
  if (!body.location || typeof body.location !== 'object' || Array.isArray(body.location)) {
    errors.push('location is required');
  } else {
    rejectUnknownFields(body.location, LOCATION_FIELDS, 'location', errors);
    if (!isFiniteInRange(body.location.latitude, -90, 90)) {
      errors.push('location.latitude must be between -90 and 90');
    }
    if (!isFiniteInRange(body.location.longitude, -180, 180)) {
      errors.push('location.longitude must be between -180 and 180');
    }
    if (!Number.isFinite(body.location.depth_km)) {
      errors.push('location.depth_km must be finite');
    }
  }
  if (!body.properties || typeof body.properties !== 'object' || Array.isArray(body.properties)) {
    errors.push('properties is required');
  } else {
    rejectUnknownFields(body.properties, PROPERTY_FIELDS, 'properties', errors);
    if (!Number.isFinite(body.properties.magnitude)) {
      errors.push('properties.magnitude must be finite');
    }
    if (typeof body.properties.source_id !== 'string' || !body.properties.source_id) {
      errors.push('properties.source_id is required');
    }
    if (body.properties.place !== undefined && typeof body.properties.place !== 'string') {
      errors.push('properties.place must be a string');
    }
    if (body.properties.source_timestamp !== undefined
      && !isIsoTimestamp(body.properties.source_timestamp)) {
      errors.push('properties.source_timestamp must be a canonical ISO 8601 timestamp');
    }
  }
  if (body.freshness !== UNASSESSED) errors.push('freshness must be "unassessed"');
  if (body.confidence !== UNASSESSED) errors.push('confidence must be "unassessed"');
  return errors;
}

export function validatePacket(packet) {
  const errors = validatePacketBody(packet);
  if (!packet || typeof packet !== 'object') return errors;
  if (!SHA_256_HEX.test(packet.packet_id || '')) {
    errors.push('packet_id must be a SHA-256 hex digest');
  }
  if (!SHA_256_HEX.test(packet.fingerprint || '')) {
    errors.push('fingerprint must be a SHA-256 hex digest');
  }
  return errors;
}

export function assertPacketBody(body) {
  const errors = validatePacketBody(body);
  if (errors.length) throw new TypeError(`Invalid EPICON packet body: ${errors.join('; ')}`);
  return body;
}

export function assertPacket(packet) {
  const errors = validatePacket(packet);
  if (errors.length) throw new TypeError(`Invalid EPICON packet: ${errors.join('; ')}`);
  return packet;
}
