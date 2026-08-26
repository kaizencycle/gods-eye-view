export const MOBIUS_INSTRUMENTS_SCHEMA_VERSION = 'MOBIUS_INSTRUMENTS_1';

const DEFAULT_TERMINAL_URL = 'https://terminal.mobius-substrate.com';
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const ALERT_SEVERITIES = new Set(['info', 'warning', 'critical']);

export class TerminalVerificationUnavailableError extends Error {
  constructor() {
    super('Terminal verification requires a configured same-origin server proxy');
    this.name = 'TerminalVerificationUnavailableError';
  }
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function nullableText(value, field) {
  return value === null ? null : text(value, field);
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be boolean`);
  return value;
}

function nullableBool(value, field) {
  return value === null ? null : bool(value, field);
}

function finite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function nullableFinite(value, field) {
  return value === null ? null : finite(value, field);
}

function nonNegativeInteger(value, field) {
  const numeric = finite(value, field);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return numeric;
}

function nullableNonNegativeInteger(value, field) {
  return value === null ? null : nonNegativeInteger(value, field);
}

function cloneJson(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function normalizeGi(value) {
  const gi = plainObject(value, 'gi');
  return {
    score: nullableFinite(gi.score, 'gi.score'),
    provenance: nullableText(gi.provenance, 'gi.provenance'),
    verified: nullableBool(gi.verified, 'gi.verified'),
    conflict: nullableBool(gi.conflict, 'gi.conflict'),
    floored: nullableBool(gi.floored, 'gi.floored'),
    source: nullableText(gi.source, 'gi.source'),
    mode: nullableText(gi.mode, 'gi.mode'),
  };
}

function normalizeInstrumentItem(value, index) {
  const item = plainObject(value, `instruments.items[${index}]`);
  return {
    id: text(item.id, `instruments.items[${index}].id`),
    agent: text(item.agent, `instruments.items[${index}].agent`),
    label: text(item.label, `instruments.items[${index}].label`),
    score: finite(item.score, `instruments.items[${index}].score`),
    source: text(item.source, `instruments.items[${index}].source`),
    ...(item.latencyMs === undefined
      ? {}
      : { latencyMs: finite(item.latencyMs, `instruments.items[${index}].latencyMs`) }),
  };
}

function normalizeFailedInstrument(value, index) {
  const item = plainObject(value, `instruments.failed[${index}]`);
  return {
    id: text(item.id, `instruments.failed[${index}].id`),
    agent: text(item.agent, `instruments.failed[${index}].agent`),
    error: text(item.error, `instruments.failed[${index}].error`),
  };
}

function normalizeAgent(value, index) {
  const agent = plainObject(value, `agents[${index}]`);
  return {
    agent: text(agent.agent, `agents[${index}].agent`),
    score: finite(agent.score, `agents[${index}].score`),
    errorCount: nonNegativeInteger(agent.errorCount, `agents[${index}].errorCount`),
    weight: finite(agent.weight, `agents[${index}].weight`),
  };
}

function normalizeAlert(value, index) {
  const alert = plainObject(value, `alerts[${index}]`);
  if (!ALERT_SEVERITIES.has(alert.severity)) {
    throw new TypeError(`alerts[${index}].severity is unsupported`);
  }
  return {
    severity: alert.severity,
    message: text(alert.message, `alerts[${index}].message`),
    ...(alert.context === undefined
      ? {}
      : { context: text(alert.context, `alerts[${index}].context`) }),
    ...(alert.timestamp === undefined
      ? {}
      : { timestamp: text(alert.timestamp, `alerts[${index}].timestamp`) }),
  };
}

/** Validate and detach the public MOBIUS_INSTRUMENTS_1 response. */
export function normalizeInstrumentsSnapshot(value) {
  const snapshot = plainObject(value, 'instruments snapshot');
  if (snapshot.schema_version !== MOBIUS_INSTRUMENTS_SCHEMA_VERSION) {
    throw new TypeError(`schema_version must be ${MOBIUS_INSTRUMENTS_SCHEMA_VERSION}`);
  }
  const timestamp = text(snapshot.timestamp, 'timestamp');
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError('timestamp must be ISO 8601');
  const cycle = plainObject(snapshot.cycle, 'cycle');
  const mic = plainObject(snapshot.mic, 'mic');
  const instruments = plainObject(snapshot.instruments, 'instruments');
  const kv = plainObject(snapshot.kv, 'kv');
  if (!Array.isArray(instruments.failed)) throw new TypeError('instruments.failed must be an array');
  if (!Array.isArray(instruments.items)) throw new TypeError('instruments.items must be an array');
  if (!Array.isArray(snapshot.agents)) throw new TypeError('agents must be an array');
  if (!Array.isArray(snapshot.alerts)) throw new TypeError('alerts must be an array');
  if (snapshot.lanes !== null) plainObject(snapshot.lanes, 'lanes');

  return {
    schema_version: MOBIUS_INSTRUMENTS_SCHEMA_VERSION,
    timestamp: new Date(timestamp).toISOString(),
    ok: bool(snapshot.ok, 'ok'),
    degraded: bool(snapshot.degraded, 'degraded'),
    gi: normalizeGi(snapshot.gi),
    cycle: {
      id: text(cycle.id, 'cycle.id'),
      execution_authorized: bool(cycle.execution_authorized, 'cycle.execution_authorized'),
    },
    mic: {
      readiness_source: nullableText(mic.readiness_source, 'mic.readiness_source'),
      supply: nullableFinite(mic.supply, 'mic.supply'),
      supply_source: nullableText(mic.supply_source, 'mic.supply_source'),
    },
    instruments: {
      count: nullableNonNegativeInteger(instruments.count, 'instruments.count'),
      errors: nullableNonNegativeInteger(instruments.errors, 'instruments.errors'),
      fallbacks_used: nullableNonNegativeInteger(
        instruments.fallbacks_used,
        'instruments.fallbacks_used',
      ),
      failed: instruments.failed.map(normalizeFailedInstrument),
      items: instruments.items.map(normalizeInstrumentItem),
      cached: bool(instruments.cached, 'instruments.cached'),
      degraded: bool(instruments.degraded, 'instruments.degraded'),
    },
    agents: snapshot.agents.map(normalizeAgent),
    lanes: cloneJson(snapshot.lanes),
    kv: {
      continuity_ok: nullableBool(kv.continuity_ok, 'kv.continuity_ok'),
      diagnostic_ok: nullableBool(kv.diagnostic_ok, 'kv.diagnostic_ok'),
    },
    alerts: snapshot.alerts.map(normalizeAlert),
  };
}

function normalizeTerminalUrl(value) {
  const url = new URL(value || DEFAULT_TERMINAL_URL);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Terminal URL must use HTTP or HTTPS');
  }
  return url.href.replace(/\/$/, '');
}

function normalizeVerifyEndpoint(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || /[\u0000-\u0020]/.test(value)) {
    throw new TypeError('Terminal verify endpoint must be a same-origin relative path');
  }
  const base = new URL(globalThis.location?.origin || 'https://world.invalid');
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin || resolved.hash) {
    throw new TypeError('Terminal verify endpoint must be a same-origin relative path');
  }
  return `${resolved.pathname}${resolved.search}`;
}

export class TerminalBridge {
  constructor({
    terminalUrl = DEFAULT_TERMINAL_URL,
    pollMs = DEFAULT_POLL_MS,
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    liveUpdates = true,
    verifyEndpoint = null,
    fetchFn = globalThis.fetch,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    now = () => Date.now(),
  } = {}) {
    if (typeof fetchFn !== 'function') throw new TypeError('Terminal bridge requires fetch');
    this.terminalUrl = normalizeTerminalUrl(terminalUrl);
    this.pollMs = Math.max(1_000, Number(pollMs) || DEFAULT_POLL_MS);
    this.requestTimeoutMs = Math.max(1_000, Number(requestTimeoutMs) || DEFAULT_TIMEOUT_MS);
    this.liveUpdates = liveUpdates === true;
    this.verifyEndpoint = normalizeVerifyEndpoint(verifyEndpoint);
    // Keep browser-native callables detached from this TerminalBridge instance.
    // Calling a stored `window.fetch` as `this.fetchFn()` supplies the bridge as
    // its receiver and Chromium rejects it with "Illegal invocation".
    this.fetchFn = (...args) => fetchFn(...args);
    this.setTimer = (...args) => setTimer(...args);
    this.clearTimer = (...args) => clearTimer(...args);
    this.now = now;
    this.listeners = new Set();
    this.state = null;
    this.status = {
      phase: 'idle',
      lastSuccessAt: null,
      error: null,
    };
    this._timer = null;
    this._inflight = null;
    this._controllers = new Set();
    this._running = false;
    this._destroyed = false;
  }

  getState() {
    return cloneJson(this.state);
  }

  getStatus() {
    return { ...this.status };
  }

  canVerify() {
    return this.verifyEndpoint !== null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.getState(), this.getStatus());
    return () => this.listeners.delete(listener);
  }

  _notify() {
    const state = this.getState();
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(state, status);
      } catch {
        // A presentation listener cannot break bridge polling.
      }
    }
  }

  _setStatus(phase, error = null) {
    if (this._destroyed) return;
    this.status = {
      phase,
      lastSuccessAt: this.status.lastSuccessAt,
      error: error ? String(error.message || error) : null,
    };
    this._notify();
  }

  _adoptSnapshot(value) {
    if (this._destroyed) return false;
    const next = normalizeInstrumentsSnapshot(value);
    if (this.state && Date.parse(next.timestamp) < Date.parse(this.state.timestamp)) {
      this._setStatus(this.state.degraded || !this.state.ok ? 'degraded' : 'connected');
      return false;
    }
    this.state = next;
    this.status = {
      phase: this.state.degraded || !this.state.ok ? 'degraded' : 'connected',
      lastSuccessAt: this.now(),
      error: null,
    };
    this._notify();
    return true;
  }

  async _request(url, options = {}) {
    const controller = new AbortController();
    this._controllers.add(controller);
    const timeout = this.setTimer(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchFn(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      this.clearTimer(timeout);
      this._controllers.delete(controller);
    }
  }

  async _refresh() {
    if (this._destroyed) return false;
    this._setStatus(this.state ? 'refreshing' : 'loading');
    try {
      const response = await this._request(`${this.terminalUrl}/api/instruments`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response?.ok) throw new Error(`Terminal instruments HTTP ${response?.status || 0}`);
      this._adoptSnapshot(await response.json());
      return true;
    } catch (error) {
      this._setStatus('offline', error);
      return false;
    }
  }

  _schedule() {
    if (!this._running || !this.liveUpdates || this._destroyed || this._timer !== null) return;
    this._timer = this.setTimer(async () => {
      this._timer = null;
      await this.poll();
      this._schedule();
    }, this.pollMs);
  }

  async initialize() {
    if (this._destroyed) return false;
    this._running = true;
    const initialized = await this.poll();
    this._schedule();
    return initialized;
  }

  async poll() {
    if (this._inflight) return this._inflight;
    this._inflight = this._refresh().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  async verifyObservation(packet) {
    if (!this.canVerify()) throw new TerminalVerificationUnavailableError();
    if (!packet || typeof packet !== 'object' || typeof packet.packet_id !== 'string') {
      throw new TypeError('Terminal verification requires an EPICON packet');
    }
    const response = await this._request(this.verifyEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        packet_id: packet.packet_id,
        observation: packet,
      }),
    });
    const verdict = await response.json();
    if (!response.ok || verdict?.ok !== true) {
      throw new Error(verdict?.error || `Terminal verification HTTP ${response.status}`);
    }
    if (verdict.instruments_snapshot) this._adoptSnapshot(verdict.instruments_snapshot);
    return verdict;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._running = false;
    if (this._timer !== null) this.clearTimer(this._timer);
    this._timer = null;
    for (const controller of this._controllers) controller.abort();
    this._controllers.clear();
    this.listeners.clear();
  }
}
