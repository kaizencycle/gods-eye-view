export function formatInstrumentValue(value, digits = null) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  return Number.isInteger(digits) ? value.toFixed(digits) : String(value);
}

function connectionView(status = {}) {
  switch (status.phase) {
    case 'connected':
      return { label: 'LIVE', tone: 'ok' };
    case 'degraded':
      return { label: 'DEGRADED', tone: 'warning' };
    case 'offline':
      return { label: 'OFFLINE', tone: 'danger' };
    case 'refreshing':
      return { label: 'REFRESHING', tone: 'neutral' };
    case 'loading':
      return { label: 'CONNECTING', tone: 'neutral' };
    case 'idle':
    default:
      return { label: 'IDLE', tone: 'neutral' };
  }
}

function evidenceView(evidence) {
  if (!evidence?.packetId) {
    return { visible: false, packetId: '', label: '', tone: 'neutral', detail: '' };
  }
  const packetId = String(evidence.packetId).slice(0, 12);
  switch (evidence.status) {
    case 'verifying':
      return {
        visible: true,
        packetId,
        label: 'VERIFYING',
        tone: 'neutral',
        detail: 'Terminal evaluation in progress',
      };
    case 'evaluated': {
      const accepted = evidence.verdict?.accepted === true;
      return {
        visible: true,
        packetId,
        label: accepted ? 'ACCEPTED' : 'NOT ACCEPTED',
        tone: accepted ? 'ok' : 'warning',
        detail: evidence.verdict?.note || 'Terminal evaluation complete',
      };
    }
    case 'failed':
      return {
        visible: true,
        packetId,
        label: 'VERIFY FAILED',
        tone: 'danger',
        detail: evidence.error || 'Terminal verification unavailable',
      };
    case 'pending':
    default:
      return {
        visible: true,
        packetId,
        label: 'PENDING TERMINAL VERIFY',
        tone: 'warning',
        detail: 'Local EPICON packet saved; server proxy not configured',
      };
  }
}

/** Build a presentation-only model without converting unknowns into zeros. */
export function createInstrumentPanelView(snapshot, status = {}, evidence = null) {
  const state = snapshot || {};
  const hasSnapshot = snapshot !== null && snapshot !== undefined;
  const offline = status.phase === 'offline';
  const stale = offline && hasSnapshot;
  const failed = Array.isArray(state.instruments?.failed) ? state.instruments.failed : [];
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  return {
    connection: {
      ...connectionView(status),
      detail: offline
        ? hasSnapshot
          ? `Cached snapshot stale · ${state.timestamp || 'timestamp unavailable'}`
          : 'No Terminal snapshot available'
        : '',
    },
    timestamp: state.timestamp || null,
    gi: {
      value: formatInstrumentValue(state.gi?.score, 3),
      detail: [state.gi?.source, state.gi?.provenance].filter(Boolean).join(' · ') || 'unavailable',
      tone: offline
        ? 'warning'
        : state.gi?.conflict
        ? 'danger'
        : (state.degraded || state.gi?.verified !== true ? 'warning' : 'ok'),
    },
    cycle: {
      value: state.cycle?.id || '—',
      detail: state.cycle?.execution_authorized === true
        ? 'EXECUTION AUTHORIZED'
        : state.cycle?.execution_authorized === false ? 'OBSERVE ONLY' : 'UNKNOWN',
    },
    mic: {
      visible: Number.isFinite(state.mic?.supply),
      value: formatInstrumentValue(state.mic?.supply),
      detail: state.mic?.supply_source || state.mic?.readiness_source || 'unavailable',
    },
    instruments: {
      value: formatInstrumentValue(state.instruments?.count),
      detail: `${stale ? 'STALE · ' : ''}${
        state.instruments?.count === null || state.instruments?.count === undefined
        ? 'UNAVAILABLE'
        : state.instruments?.degraded ? 'DEGRADED' : 'NOMINAL'
      }`,
      tone: offline
        ? 'warning'
        : state.instruments?.count === null || state.instruments?.count === undefined
        ? 'warning'
        : state.instruments?.degraded ? 'warning' : 'ok',
      errors: formatInstrumentValue(state.instruments?.errors),
      fallbacks: formatInstrumentValue(state.instruments?.fallbacks_used),
    },
    kv: {
      value: state.kv?.continuity_ok === true
        ? 'CONTINUOUS'
        : state.kv?.continuity_ok === false ? 'BROKEN' : 'UNKNOWN',
      tone: offline
        ? 'warning'
        : state.kv?.continuity_ok === true
        ? 'ok'
        : state.kv?.continuity_ok === false ? 'danger' : 'warning',
      detail: `${stale ? 'stale · ' : ''}${state.kv?.diagnostic_ok === true
        ? 'diagnostics nominal'
        : state.kv?.diagnostic_ok === false ? 'diagnostics degraded' : 'diagnostics unknown'}`,
    },
    agents: (state.agents || []).map((agent) => ({
      name: String(agent.agent),
      score: formatInstrumentValue(agent.score, 3),
      errors: formatInstrumentValue(agent.errorCount),
      weight: formatInstrumentValue(agent.weight, 2),
    })),
    items: (state.instruments?.items || []).map((item) => ({
      id: String(item.id),
      agent: String(item.agent),
      label: String(item.label),
      score: formatInstrumentValue(item.score, 3),
      source: String(item.source),
    })),
    alerts: [
      ...alerts.map((alert) => ({
        severity: alert.severity,
        message: String(alert.message),
        context: alert.context ? String(alert.context) : '',
      })),
      ...failed.map((item) => ({
        severity: 'critical',
        message: `${item.agent} · ${item.id}`,
        context: String(item.error),
      })),
    ],
    evidence: evidenceView(evidence),
    statusError: status.error || null,
  };
}

function createElement(tag, className, text = null) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = text;
  return element;
}

function appendMetric(container, label, value, detail, tone = 'neutral') {
  const card = createElement('div', `terminal-metric terminal-tone-${tone}`);
  card.append(
    createElement('span', 'terminal-metric-label', label),
    createElement('strong', 'terminal-metric-value', value),
    createElement('span', 'terminal-metric-detail', detail),
  );
  container.appendChild(card);
}

export class InstrumentPanel {
  constructor({ bridge, verification, root = null } = {}) {
    if (!bridge || typeof bridge.subscribe !== 'function') {
      throw new TypeError('Instrument panel requires a Terminal bridge');
    }
    this.bridge = bridge;
    this.verification = verification || null;
    this.root = root;
    this.body = null;
    this.state = bridge.getState?.() || null;
    this.status = bridge.getStatus?.() || { phase: 'idle' };
    this.evidence = verification?.getState?.() || null;
    this._unsubscribeBridge = null;
    this._unsubscribeVerification = null;
  }

  mount() {
    this.root ||= document.getElementById('terminal-instruments-panel');
    if (!this.root) throw new Error('Terminal instrument panel host is missing');
    this.body = this.root.querySelector('[data-terminal-instruments-body]');
    if (!this.body) throw new Error('Terminal instrument panel body is missing');
    this.root.hidden = false;
    this._unsubscribeBridge = this.bridge.subscribe((state, status) => {
      this.state = state;
      this.status = status;
      this.render();
    });
    this._unsubscribeVerification = this.verification?.subscribe?.((evidence) => {
      this.evidence = evidence;
      this.render();
    }) || null;
    this.render();
    return this;
  }

  render() {
    if (!this.body) return;
    const view = createInstrumentPanelView(this.state, this.status, this.evidence);
    const fragment = document.createDocumentFragment();

    const connection = createElement(
      'div',
      `terminal-connection terminal-tone-${view.connection.tone}`,
      view.connection.label,
    );
    connection.setAttribute('role', 'status');
    fragment.appendChild(connection);
    if (view.connection.detail) {
      fragment.appendChild(createElement(
        'p',
        'terminal-connection-detail',
        view.connection.detail,
      ));
    }

    if (view.statusError) {
      fragment.appendChild(createElement('p', 'terminal-bridge-error', view.statusError));
    }

    const metrics = createElement('div', 'terminal-metrics-grid');
    appendMetric(metrics, 'Global Integrity', view.gi.value, view.gi.detail, view.gi.tone);
    appendMetric(metrics, 'Cycle', view.cycle.value, view.cycle.detail);
    if (view.mic.visible) appendMetric(metrics, 'MIC Supply', view.mic.value, view.mic.detail);
    appendMetric(
      metrics,
      'Instruments',
      view.instruments.value,
      `${view.instruments.detail} · ERR ${view.instruments.errors} · FB ${view.instruments.fallbacks}`,
      view.instruments.tone,
    );
    appendMetric(metrics, 'KV Continuity', view.kv.value, view.kv.detail, view.kv.tone);
    fragment.appendChild(metrics);

    if (view.evidence.visible) {
      const evidence = createElement(
        'section',
        `terminal-evidence terminal-tone-${view.evidence.tone}`,
      );
      evidence.append(
        createElement('span', 'terminal-section-label', 'Latest EPICON'),
        createElement('strong', 'terminal-evidence-status', view.evidence.label),
        createElement('code', 'terminal-packet-id', view.evidence.packetId),
        createElement('p', 'terminal-evidence-detail', view.evidence.detail),
      );
      fragment.appendChild(evidence);
    }

    const agents = createElement('section', 'terminal-instruments-section');
    agents.appendChild(createElement('span', 'terminal-section-label', 'Agent composites'));
    if (view.agents.length === 0) {
      agents.appendChild(createElement('p', 'terminal-empty-state', 'No agent composites reported'));
    } else {
      const list = createElement('div', 'terminal-agent-list');
      for (const agent of view.agents) {
        const row = createElement('div', 'terminal-agent-row');
        row.append(
          createElement('strong', null, agent.name),
          createElement('span', null, agent.score),
          createElement('small', null, `ERR ${agent.errors} · W ${agent.weight}`),
        );
        list.appendChild(row);
      }
      agents.appendChild(list);
    }
    fragment.appendChild(agents);

    const instruments = createElement('section', 'terminal-instruments-section');
    instruments.appendChild(createElement('span', 'terminal-section-label', 'Instrument registry'));
    if (view.items.length === 0) {
      instruments.appendChild(createElement(
        'p',
        'terminal-empty-state',
        'Instrument payload unavailable in the current Terminal snapshot',
      ));
    } else {
      const list = createElement('div', 'terminal-instrument-list');
      for (const item of view.items) {
        const row = createElement('div', 'terminal-instrument-row');
        row.append(
          createElement('strong', null, item.label),
          createElement('span', null, item.score),
          createElement('small', null, `${item.agent} · ${item.source}`),
        );
        list.appendChild(row);
      }
      instruments.appendChild(list);
    }
    fragment.appendChild(instruments);

    const alerts = createElement('section', 'terminal-instruments-section');
    alerts.appendChild(createElement('span', 'terminal-section-label', 'Alerts'));
    if (view.alerts.length === 0) {
      alerts.appendChild(createElement('p', 'terminal-empty-state', 'No active alerts'));
    } else {
      const list = createElement('div', 'terminal-alert-list');
      for (const alert of view.alerts) {
        const row = createElement('div', `terminal-alert terminal-alert-${alert.severity}`);
        row.append(
          createElement('strong', null, alert.message),
          createElement('small', null, alert.context),
        );
        list.appendChild(row);
      }
      alerts.appendChild(list);
    }
    fragment.appendChild(alerts);

    this.body.replaceChildren(fragment);
  }

  destroy() {
    this._unsubscribeBridge?.();
    this._unsubscribeBridge = null;
    this._unsubscribeVerification?.();
    this._unsubscribeVerification = null;
    if (this.root) this.root.hidden = true;
    this.body?.replaceChildren();
  }
}

export function attachInstrumentPanel(options) {
  return new InstrumentPanel(options).mount();
}
