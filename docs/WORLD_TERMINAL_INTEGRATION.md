# World Renderer × Mobius Terminal

**Cycle:** C-412

**Terminal contract:** `MOBIUS_INSTRUMENTS_1`

## Boundary

Terminal remains the protocol-state authority. God's Eye View remains the
observation renderer and citizen-facing view.

```text
Terminal GET /api/instruments
  → polling TerminalBridge
  → validated MOBIUS_INSTRUMENTS_1 snapshot
  → right-rail instrument panel

accepted earthquake click
  → local EPICON v0.1 packet
  → local evidence status
  → optional same-origin verification proxy
```

World never invents GI, MIC, cycle, agent, instrument, confidence, witness, or
custody values. Null and degraded fields remain visibly unavailable/degraded.

## Configuration

All browser-visible settings use Vite's `VITE_` prefix:

```bash
VITE_TERMINAL_INSTRUMENTS_ENABLED=true
VITE_TERMINAL_API_URL=https://terminal.mobius-substrate.com
VITE_TERMINAL_LIVE_UPDATES=true
VITE_TERMINAL_POLL_MS=15000
```

The integration is disabled unless
`VITE_TERMINAL_INSTRUMENTS_ENABLED=true`. Disabling it leaves the existing
globe, HUD, layers, and C-411 local packet capture unchanged.

## Polling

V1 deliberately uses HTTP polling rather than WebSocket:

- initial `GET /api/instruments` during app initialization;
- production default: 15 seconds;
- one request at a time;
- 8-second request timeout;
- `cache: "no-store"` and no browser credentials;
- failed polls retain the last accepted snapshot and mark the panel offline;
- successful degraded responses remain degraded rather than being smoothed.

The bridge accepts only the `MOBIUS_INSTRUMENTS_1` schema and copies known
fields. Unknown top-level fields are forward-compatible and ignored.

## HUD

The instrument panel participates in the existing right-rail adaptive layout
and world-overlay exclusion inventory. It is hidden below 768 px and while
Cockpit owns the right rail.

The panel displays only supplied Terminal values:

| Surface | Terminal field |
| --- | --- |
| Global Integrity | `gi.score`, `gi.source`, `gi.provenance` |
| Cycle | `cycle.id`, `cycle.execution_authorized` |
| MIC | `mic.supply` only when non-null |
| Instrument summary | `instruments.count`, errors, fallbacks, degraded |
| Instrument registry | every supplied `instruments.items[]` entry |
| Agent composites | `agents[]` |
| KV continuity | `kv.continuity_ok`, `kv.diagnostic_ok` |
| Alerts | `alerts[]` plus `instruments.failed[]` |
| Latest evidence | local C-411 packet and optional Terminal verdict |

Remote strings are rendered with DOM `textContent`; Terminal payloads are never
inserted as HTML.

## Observation verification

Terminal's `POST /api/world/verify-observation` requires
`CRON_SECRET` or `MOBIUS_SERVICE_SECRET`. Those credentials must never enter a
browser bundle.

For this reason, browser verification is disabled by default. A locally
captured packet appears as:

```text
PENDING TERMINAL VERIFY
Local EPICON packet saved; server proxy not configured
```

A future deployment may configure:

```bash
VITE_TERMINAL_VERIFY_ENDPOINT=/api/terminal/verify
```

The value must be a same-origin relative path. That endpoint must be a
rate-limited server-side proxy that adds service authorization and forwards to
Terminal. This repository does not expose a public secret-bearing proxy in
C-412.

When configured, the bridge sends:

```json
{
  "packet_id": "<EPICON packet id>",
  "observation": {
    "packet_id": "<EPICON packet id>"
  }
}
```

The full `observation` value is the local EPICON packet. A returned
`instruments_snapshot` is validated and adopted immediately. `accepted:false`
is displayed as “NOT ACCEPTED,” not as a transport failure.

## Developer diagnostics

When enabled:

```js
const {
  terminalBridge,
  packetVerification,
  instrumentPanel,
} = window.__godsEyeView;

terminalBridge.getStatus();
terminalBridge.getState();
await terminalBridge.poll();
packetVerification.getState();
```

## Operations

Check the live public facade:

```bash
curl -sS https://terminal.mobius-substrate.com/api/instruments \
  | jq '{schema:.schema_version, ok, degraded, gi:.gi.score, cycle:.cycle.id, n:.instruments.count}'
```

Expected behavior is truthful rather than always green. For example, a response
with `degraded:true`, `instruments.count:null`, and an empty item list renders a
degraded panel with no synthetic registry.

## Out of scope

- Browser-held service credentials
- Direct browser calls to Terminal write routes
- WebSocket transport
- Historical confidence timelines
- Invented agent participation
- Persistent shared World state
- Multi-user collaboration
