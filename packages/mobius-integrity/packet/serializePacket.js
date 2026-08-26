import { assertPacket } from '../schema/validation.js';

/** Serialize one EPICON packet as stable, human-readable local JSON. */
export function serializePacket(packet) {
  assertPacket(packet);
  return `${JSON.stringify(packet, null, 2)}\n`;
}

/** Parse EPICON JSON without treating parsing as integrity validation. */
export function deserializePacket(jsonString) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    throw new TypeError('EPICON packet JSON must be a non-empty string');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    throw new SyntaxError(`Failed to parse EPICON packet JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('EPICON packet JSON must contain an object');
  }
  return parsed;
}
