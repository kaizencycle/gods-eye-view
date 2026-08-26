# EPICON Evidence Packet v0.1

**Cycle:** C-411

**Status:** Developer prototype

**Scope:** One accepted USGS earthquake selected in God's Eye View

## Purpose

EPICON v0.1 proves one mechanical path:

```text
God's Eye earthquake observation
  → invisible Mobius click adapter
  → deterministic EPICON packet
  → local JSON
  → replay and fingerprint validation
```

It does not add a visible button, popup, card, overlay, or renderer behavior.
God's Eye View remains responsible for acquisition and rendering. The isolated
package under `packages/mobius-integrity/` owns packet construction, hashing,
local JSON persistence, and replay.

## Schema

The machine-readable schema is
`packages/mobius-integrity/schema/v0.json`.

| Field | Type | v0.1 meaning |
| --- | --- | --- |
| `packet_id` | SHA-256 hex | Fingerprint of the canonical packet body |
| `fingerprint` | SHA-256 hex | Copy of `packet_id` used during replay |
| `packet_version` | string | Always `"0.1"` |
| `event_id` | string | Namespaced USGS event identity |
| `event_type` | string | Always `"earthquake"` |
| `timestamp` | ISO 8601 | Time the operator clicked the accepted observation |
| `source` | string | Always `"USGS"` in this integration |
| `renderer` | string | Always `"gods-eye-view"` |
| `location` | object | WGS84 latitude/longitude and earthquake depth |
| `properties` | object | Magnitude, USGS source ID, place, and source time |
| `freshness` | string | `"unassessed"` in v0.1 |
| `confidence` | string | `"unassessed"` in v0.1 |

Freshness and confidence are intentionally not numeric placeholders. Their
policies belong to a later integrity phase; assigning values here would turn an
unimplemented policy into apparent evidence.

## Lifecycle

The adapter is attached in `src/main.js` after production layers are registered
and before passive layer restoration starts.

1. The adapter subscribes to `DataLayerManager`.
2. A completed earthquake enable transition (`visibility-transition` with
   `lifecycleState: "enabling"`, followed by enabled `visibility`) or a
   successful `refresh` event causes the adapter to read
   `earthquakesLayer.getAnalystRecords()` and retain canonical fingerprints for
   that accepted snapshot. A standalone idempotent `visibility` event is not
   accepted.
3. `refresh-failed` and `refresh-cancelled` do not advance the accepted
   snapshot.
4. A separate Cesium click handler recognizes only `earthquake:*` picks.
5. The current complete record must exactly match the last accepted snapshot.
   A partial record left visible by a failed refresh is rejected.
6. `createPacket()` normalizes the accepted record and click timestamp.
7. `computeFingerprint()` hashes the canonical packet body.
8. The complete packet is saved as JSON in browser local storage.

The adapter registers earthquake pick ownership so other layer handlers do not
misclassify an earthquake click as empty space. It does not move the camera,
select a Cesium entity, or alter any rendered object.

Incomplete analyst records are excluded individually rather than invalidating
valid siblings. When USGS omits its event ID, the renderer's `event-N` fallback
pick is resolved to the analyst projection's same-position `QUAKE-NNNN`
identity before accepted-snapshot comparison.

## Fingerprint rules

`packages/mobius-integrity/hashing/computeFingerprint.js` defines canonical
serialization:

1. Remove `packet_id` and `fingerprint` from the hash input.
2. Recursively sort every object by key.
3. Preserve array order.
4. Use compact JSON with no insignificant whitespace.
5. Require finite JSON numbers and normalize negative zero to zero.
6. Encode canonical JSON as UTF-8.
7. Compute SHA-256 with the browser-compatible Web Crypto API.
8. Encode the digest as 64 lowercase hexadecimal characters.

No field is rounded for hashing. An identical normalized observation and click
timestamp therefore produces an identical packet ID; any covered field change
produces a different ID.

### Security boundary

The fingerprint proves deterministic self-consistency, not authenticity. It
detects accidental corruption and a body changed without updating its identity,
but a party able to rewrite the JSON can also recompute both unsigned hash
fields. Signatures and authenticated custody are deliberately absent from
v0.1.

## Local JSON

Packets use these local-storage keys:

```text
epicon:v0.1:packet-index
epicon:v0.1:packet:<packet_id>
```

The index contains packet IDs. Each packet key contains pretty-printed JSON.
Saving the same deterministic packet is idempotent. If browser local storage is
unavailable—or rejects a write because of privacy or quota policy—the package
falls back to session-only memory so the optional prototype cannot prevent
God's Eye View from starting. An existing packet ID cannot be overwritten with
different bytes.

No packet is sent over the network.

## Developer replay

After enabling Earthquakes and clicking a rendered earthquake, use:

```js
const epicon = window.__godsEyeView.mobiusAdapter;
const [packetId] = epicon.listPacketIds();
await epicon.readPacket(packetId);
epicon.readPacketJson(packetId);
await epicon.replay(packetId);
```

The repository example can be replayed from a terminal:

```bash
node packages/mobius-integrity/examples/replay.mjs \
  packages/mobius-integrity/examples/earthquake.json
```

Replay parses the JSON, validates the v0.1 shape, removes the two identity
fields, recomputes SHA-256 from the canonical body, and requires both
`packet_id` and `fingerprint` to match. Replay does not render historical globe
state or claim that an old observation is live.

`readPacket()` performs the same fingerprint check and also requires the
packet's ID to match the requested storage key. `readPacketJson()` is the
explicitly unvalidated raw-JSON inspection path.

## Public functions

| Function | Responsibility |
| --- | --- |
| `createPacket(observation)` | Validate and normalize one accepted earthquake, then assign its deterministic identity |
| `serializePacket(packet)` | Produce human-readable local JSON |
| `computeFingerprint(value)` | Produce SHA-256 over canonical JSON |
| `replayPacket(json)` | Parse, validate schema, and validate fingerprint |

## Future witness fields

A later schema version may add source provenance and witness records, for
example:

```json
{
  "witnesses": [
    {
      "source": "USGS",
      "observed_at": "2026-08-25T14:30:00.000Z"
    }
  ]
}
```

Witnesses are not accepted by the v0.1 schema and are not implemented here.
Confidence models, freshness decay, signatures, custody, ledgers, agents,
authentication, databases, network synchronization, and multi-source merging
remain out of scope.
