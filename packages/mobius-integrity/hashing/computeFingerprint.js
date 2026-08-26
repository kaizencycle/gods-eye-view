const SHA_256 = 'SHA-256';

function normalizeCanonicalValue(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Canonical JSON requires a finite number at ${path}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeCanonicalValue(entry, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Canonical JSON requires a plain object at ${path}`);
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) {
        throw new TypeError(`Canonical JSON does not permit undefined at ${path}.${key}`);
      }
      result[key] = normalizeCanonicalValue(entry, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value} at ${path}`);
}

/**
 * Serialize a JSON value with recursively sorted object keys.
 *
 * Arrays retain their authored order. Numbers must be finite and negative zero
 * is normalized to zero.
 */
export function canonicalize(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

/** Return the packet fields covered by the fingerprint. */
export function fingerprintBody(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    throw new TypeError('EPICON packet must be an object');
  }
  const { packet_id: packetId, fingerprint, ...body } = packet;
  void packetId;
  void fingerprint;
  return body;
}

/** Compute a browser-compatible SHA-256 hex digest over canonical JSON. */
export async function computeFingerprint(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await subtle.digest(SHA_256, bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Validate both packet identity fields against the canonical packet body. */
export async function validateFingerprint(packet) {
  if (!packet || typeof packet !== 'object') return false;
  if (typeof packet.packet_id !== 'string' || typeof packet.fingerprint !== 'string') return false;
  const expected = await computeFingerprint(fingerprintBody(packet));
  return packet.packet_id === expected && packet.fingerprint === expected;
}
