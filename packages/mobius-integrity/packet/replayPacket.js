import { validateFingerprint } from '../hashing/computeFingerprint.js';
import { validatePacket } from '../schema/validation.js';
import { deserializePacket } from './serializePacket.js';

/** Parse packet JSON and validate both its schema and deterministic fingerprint. */
export async function replayPacket(jsonString) {
  try {
    const packet = deserializePacket(jsonString);
    const errors = validatePacket(packet);
    if (errors.length === 0 && !(await validateFingerprint(packet))) {
      errors.push('Fingerprint mismatch: packet data may have been modified');
    }
    return {
      packet,
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    return {
      packet: null,
      valid: false,
      errors: [String(error?.message || error)],
    };
  }
}

/** Print a replay result for the local developer CLI or console. */
export function printReplay(result, logger = console) {
  if (!result?.valid) {
    logger.error?.('[EPICON] INVALID PACKET');
    for (const error of result?.errors || ['Unknown replay error']) {
      logger.error?.(`[EPICON] ${error}`);
    }
    return false;
  }
  const packet = result.packet;
  logger.info?.('[EPICON] VALID PACKET');
  logger.info?.(`[EPICON] Packet ID: ${packet.packet_id}`);
  logger.info?.(`[EPICON] Event: earthquake M${packet.properties.magnitude}`);
  logger.info?.(`[EPICON] Source: ${packet.source}`);
  logger.info?.(`[EPICON] Timestamp: ${packet.timestamp}`);
  logger.info?.(
    `[EPICON] Location: ${packet.location.latitude}, ${packet.location.longitude}`,
  );
  return true;
}
