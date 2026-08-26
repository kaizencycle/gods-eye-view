# God's Eye View × Mobius Integrity Layer

**Cycle:** C-411

**Status:** Phase 1 — architecture and integration analysis only

**Reviewed revision:** `880a672b5e16`

**Implementation status:** No Mobius runtime code, packet store, or replay code is included in this phase.

## Purpose

God's Eye View (GEV) remains the observation renderer: it answers, “What is
happening?” Mobius remains an integrity protocol: it answers, “Can we trust the
record of what happened?” The integration should add an integrity record beside
an observation without moving source acquisition, rendering, or interaction
ownership into Mobius.

The target flow is:

```text
provider observation
  → existing GEV layer normalization
  → Mobius adapter
  → EPICON packet
  → local append-only replay
  → audit
```

This is deliberately not:

```text
provider observation
  → alternate globe or layer implementation
  → Mobius-owned renderer
```

## Scope and constraints

This document maps the current repository and recommends the smallest practical
integration seam. It does not change rendering, add authentication, add AI,
write to a network service, or implement later governance systems.

GEV is MIT-licensed, with copyright attributed to Bilawal Sidhu. The MIT grant
covers the source code, not bundled datasets, runtime provider data, models, or
README media. Any integration must retain `LICENSE`, the upstream history, the
in-app source credits, and the source-specific restrictions in
`DATA_SOURCES.md`. In particular, generated integrity records must not become a
way to persist provider content that the provider forbids storing.

## Current architecture

### Runtime composition

`src/main.js` is the composition root. It creates the Cesium viewer and map
stack, constructs `DataLayerManager`, registers every production layer, seals
the registry with `LAYER_STATE_REGISTRY`, and attaches UI, scene, voice, and
render-governor systems.

The relevant runtime components are:

| Concern | Current owner |
| --- | --- |
| Viewer and production wiring | `src/main.js` |
| Layer lifecycle and polling | `src/data/manager.js` (`DataLayerManager`) |
| Per-source acquisition and normalization | `src/data/*.js` layer modules |
| Durable layer preferences | `src/data/layerState.js` (`LayerStateCoordinator`) |
| Selected-entity context | `src/data/contextStore.js` |
| Cesium scene entities/primitives | Each data-layer module |
| Shared screen-space cards and labels | `src/overlays/worldOverlay.js` |
| Shared overlay drawing | `src/overlays/worldOverlayDraw.js` |
| Cross-layer pick ownership | `src/data/pickRegistry.js` |
| Render scheduling | `src/renderGovernor.js` |

GEV is a vanilla JavaScript/Vite application rather than a workspace monorepo.
The root `package.json` has no `workspaces` declaration. A future
`packages/mobius-integrity/` directory can still be an isolated ES module, but
it is not automatically an npm workspace package unless package management is
changed explicitly.

### How data enters

There are three acquisition patterns:

1. **Browser-to-provider fetch.** A layer fetches a public endpoint directly.
   Earthquakes use this pattern for the USGS GeoJSON feed.
2. **Browser-to-local proxy.** A layer calls a bounded Vite middleware endpoint
   such as `/api/opensky`, `/api/firms`, or `/api/cctv`. `vite.config.js` owns
   the proxy/API wiring. This keeps secret-bearing providers server-side and
   applies caching, quotas, and response bounds.
3. **Bundled snapshots.** `src/data/local_data/` contains static datasets loaded
   by local layer modules. Each dataset retains its own provenance and license.

Every registered layer follows the same broad lifecycle contract:

```text
DataLayerManager.register(layer)
  → setEnabled(layer, true)
  → layer.init(viewer) once
  → layer.enable(viewer)
  → layer.update(viewer) immediately
  → manager-owned periodic layer.update(viewer)
  → layer.disable(viewer)
  → layer.destroy(viewer)
```

`DataLayerManager._runPeriodicUpdate()` owns recurring refreshes. After a
successful or failed update it requests a render, invalidates detection source
state, and emits a manager event. A successful recurring refresh emits
`{ type: "refresh", layerId, refreshEpoch }`. The first update during enable is
followed by a settled `visibility` event rather than a `refresh` event.

Important boundary: manager events report lifecycle and refresh state; they do
**not** include the observations produced by a layer. `getAll()` exposes layer
identity and normalized statistics but intentionally does not expose the module
or its records.

### How layers render

Layer modules own source-specific normalization and Cesium objects. They add
entities, primitives, or data sources to the viewer, then expose normalized
statistics through `getStats()`.

Some layers also publish screen-space entries to the shared World Overlay:

```text
layer update
  → source-specific overlay entry
  → setOverlayEntries(sourceId, entries, options)
  → normalizeOverlayEntry()
  → bounded source cohort
  → projection and collision arbitration
  → paintOverlayEntry() after Cesium renders
```

`src/overlays/worldOverlay.js` owns projection, placement, collision budgets,
paint ordering, hit rectangles, and accessibility mirrors. It deliberately
treats `entry.metadata` as opaque and never reads source-specific fields.
`src/overlays/worldOverlayDraw.js` is presentation-only: it does not fetch,
query the scene, select sources, or own layer state.

Cesium and the screen-space overlay are complementary. For earthquakes, Cesium
renders the ground-clamped ellipse while World Overlay paints the magnitude
label.

### How metadata is attached

There is no single canonical observation envelope today. Metadata appears in
several purpose-specific forms:

- Cesium entity `properties` hold layer-specific values.
- World Overlay entries may carry opaque `metadata`, although earthquake
  overlay entries currently do not.
- `contextStore.js` stores selected-entity records with shared fields such as
  `id`, `layerId`, an entity carrier, and `updatedAt`.
- `getStats()` returns feed-level values such as count, last update, source
  mode, error, stale state, or fallback state, depending on the layer.
- `layerFeedState()` in `manager.js` normalizes heterogeneous feed statistics
  into presentation states: nominal, loading, degraded, stale, fallback, and
  unavailable.
- `layerState.js` persists user layer visibility and options. It is UI state,
  not observation evidence, and should not be reused as the replay store.

Because the current metadata shapes serve different consumers, an integrity
adapter should normalize a copy into EPICON without mutating the Cesium entity
or replacing existing layer metadata.

### How clicks resolve events

There is no single application-wide click dispatcher. Most interactive layers
install their own `Cesium.ScreenSpaceEventHandler`, call `scene.pick()` or
`scene.drillPick()`, recognize their own IDs, and invoke layer-specific
selection/tracking behavior.

The supporting utilities are:

- `trackingClickGesture.js` distinguishes a click from a camera drag.
- `pickRegistry.js` lets sibling handlers recognize that another layer owns a
  pick, avoiding competing deselection and camera commands.
- `scenePick.js` validates world positions returned from depth-buffer picks.
- `contextStore.js` registers normalized selected records and emits
  `gev:entity-selected` for layers that participate in that selection lane.
- World Overlay computes hit rectangles only for entries with
  `interactive: true`; `hitTestWorldOverlay()` is a resolver, not a global
  pointer listener. Sources remain responsible for invoking activation.

This decentralized ownership is intentional and should not be replaced by
Mobius.

## Earthquake lifecycle

`src/data/earthquakes.js` is the Phase 3 reference path.

### Acquisition and rendering

```text
USGS all-day GeoJSON
  → earthquakesLayer.update()
  → validate `features`
  → filter magnitude below 2.5
  → normalize id, magnitude, place, event time, depth, coordinates
  ├─→ Cesium CustomDataSource entity
  │     id: `earthquake:<USGS id>`
  │     properties: usgsId, mag, place, time, depth
  └─→ World Overlay magnitude label
        id: <USGS id>
        interactive: false
  → getStats(): count, lastUpdate, error
```

The layer polls every 60 seconds, but replacement is **not transactional**.
After validating only that `features` is an array, `update()` calls
`entities.removeAll()` and then validates records implicitly while iterating. A
malformed feature can throw after some new entities have already been added.
The catch returns `false`, so the manager emits `refresh-failed` while that
partial collection can remain visible. The prior successful `lastUpdate`
timestamp is retained.

`getAnalystRecords()` provides a useful JSON-safe projection: `id`, `magnitude`,
`depthKm`, `lat`, `lon`, `timeMs`, and `place`. Its output describes the
currently visible in-memory collection, however, and is not by itself proof
that the latest refresh completed successfully.

### Current click behavior

Earthquakes are visible but are not currently click-resolved:

- `earthquakes.js` does not install a click handler.
- its World Overlay entry sets `interactive: false`;
- it does not register earthquake records with `contextStore`;
- it does not emit a selection event.

Therefore the proposed proof of concept cannot attach only to an existing
“earthquake selected” event; that event does not exist. Any architecture that
claims otherwise would hide required integration work.

## Extension-point assessment

### Existing seams

| Seam | What exists now | Suitable use | Limitation |
| --- | --- | --- | --- |
| `DataLayerManager.subscribe()` | Lifecycle, parameter, and refresh notifications | Know when a layer settled or refreshed | No observation payload |
| Layer `getAnalystRecords()` | JSON-safe earthquake snapshot | Adapt accepted earthquake records | Method is layer-specific |
| `contextStore` events | Selected records from participating layers | Capture selections generically | Earthquakes do not participate |
| World Overlay metadata | Opaque per-entry metadata | Carry source-specific presentation context | Earthquake entry has none; ambient label is noninteractive |
| `hitTestWorldOverlay()` | Resolves interactive painted entries | Existing overlay activation | No global listener; earthquake is noninteractive |
| `window.__godsEyeView` | Dev/debug access after bootstrap | Manual prototype or diagnostics | Not a stable production integration contract |

### Proposed seams, kept distinct from existing APIs

1. **Adapter-owned earthquake click resolver — recommended for the isolated
   proof of concept.** The Mobius adapter attaches a separate Cesium click
   handler, recognizes only `earthquake:*` entity IDs, reads a plain snapshot,
   and never issues camera or rendering commands. This keeps the PoC isolated
   and avoids changing earthquake rendering. It must cooperate with existing
   gesture and pick-ownership conventions.
2. **Generic observation notification — recommended upstream candidate.** Add a
   small manager-level observer API whose successful refresh notification can
   carry or lazily retrieve provider-neutral observation records. The generic
   contract should expose provenance, not EPICON governance.
3. **Generic selection notification — useful upstream candidate.** Unify
   selected observation publication around a provider-neutral record while
   preserving layer-owned click behavior. Existing `contextStore` events are a
   starting point, not yet universal.

The manager’s current `refresh` event is a timing signal, not a complete
post-poll observation hook. Reaching through `dataManager.layers` to access a
module would depend on private manager internals and is not recommended.

### Accepted-snapshot boundary

The Mobius adapter must subscribe to manager outcomes and retain its own
accepted earthquake snapshot:

1. After a successful initial `visibility` event or recurring `refresh` event,
   call the public record reader and fingerprint every complete normalized
   record.
2. On `refresh-failed` or `refresh-cancelled`, do not replace that accepted
   snapshot or advance its ingestion epoch.
3. On click, fingerprint the picked entity's complete normalized values and
   require an exact match in the last accepted snapshot.
4. If no exact match exists, do not issue an ordinary verified packet. Report
   the observation as unaccepted/unresolved, or refuse capture in the first
   proof of concept.

Matching only the source ID is insufficient because a failed refresh can
partially replace a record while retaining the same USGS ID. This adapter-owned
boundary avoids associating partial displayed state with the previous
successful ingestion epoch without requiring a core-layer change.

## Recommended Mobius attachment

### Minimal runtime wiring

An isolated package cannot execute merely by existing in `packages/`; the
application must load it. The smallest explicit integration is one import and
one attachment call at the composition root after `dataManager` and the viewer
exist. The composition root must also pass a public record reader; the package
must not discover the layer by reaching into `dataManager.layers`:

```js
attachMobiusIntegrity({
  viewer,
  dataManager,
  sources: {
    earthquakes: {
      getRecords: () => earthquakesLayer.getAnalystRecords(),
    },
  },
});
```

That call is proposed Phase 2/3 wiring, not present in Phase 1. It should return
a disposer and must not modify manager methods, monkey-patch layer updates, or
write to `window.__godsEyeView`.

Recommended internal package boundaries:

```text
packages/mobius-integrity/
├── adapters/       # GEV observation/click normalization only
├── epicon/         # deterministic packet creation and validation
├── confidence/     # explicit, policy-owned confidence calculation
├── witnesses/      # witness representation; one USGS witness in the PoC
├── replay/         # local append/read/verify operations
└── index.js        # attach/dispose public API
```

GEV-specific code belongs only in `adapters/`. EPICON and replay modules must
accept plain JSON-safe values and must not import Cesium or GEV modules. This is
what keeps the protocol reusable with another renderer.

### Observation and click lanes

Keep two separate facts:

1. **Source observation:** an accepted USGS record entered GEV during a
   particular refresh.
2. **Operator observation:** a user selected that rendered earthquake.

The source observation may create a normalized candidate in memory. The click
creates and locally appends the EPICON packet for the PoC. Recording both lanes
later is possible, but conflating poll time with click time would make replay
ambiguous. A displayed entity is eligible for the ordinary packet path only
when its full normalized fingerprint matches the adapter's last accepted
snapshot.

### Candidate EPICON packet

The exact EPICON schema belongs to Mobius, not GEV. The adapter should supply
plain inputs sufficient to build a deterministic packet:

```json
{
  "eventId": "usgs:<event-id>",
  "kind": "earthquake",
  "source": {
    "name": "USGS",
    "recordId": "<event-id>",
    "mode": "live"
  },
  "observedAt": "<operator click time>",
  "sourceTimestamp": "<USGS event time>",
  "ingestedAt": "<GEV accepted-refresh time>",
  "freshness": {
    "ageMs": "<derived integer>",
    "status": "<policy result>"
  },
  "confidence": {
    "value": null,
    "basis": "policy-not-yet-defined"
  },
  "witnesses": [
    {
      "id": "USGS",
      "type": "source"
    }
  ],
  "observation": {
    "magnitude": 0,
    "place": "",
    "depthKm": 0,
    "latitude": 0,
    "longitude": 0
  },
  "replayHash": "<deterministic digest>"
}
```

Values above are shape examples, not settled semantics. In particular:

- confidence must not be invented from UI feed status;
- “witness count” is derived from the witness array, not independently stored;
- freshness should be a deterministic function of source, ingestion, and click
  timestamps with documented thresholds;
- packet hashing requires canonical serialization, a named digest algorithm,
  and schema/protocol versions;
- `eventId` identifies the source event, while a separate packet ID may be
  required to distinguish repeated observations of that event.

### Local replay

The PoC replay store should be local, append-only at its public API, and
replaceable. IndexedDB is preferable for application use; an in-memory adapter
is sufficient for deterministic unit tests. Local storage is already used for
small UI preferences but is not appropriate for a growing evidence log.

Replay should:

1. read packet bytes from local storage;
2. canonicalize the unsigned/hashable packet fields;
3. recompute and compare the replay hash;
4. return the verified packet plus an explicit valid/invalid result;
5. never mutate GEV layer state or re-render source observations as if they were
   current live data.

“Replay” in this PoC means reconstructing and auditing the integrity record. It
does not mean historical globe playback.

## Generic upstream contribution

A provider-neutral Event Provenance API could benefit every GEV consumer. It
should describe:

- source and source record ID;
- source timestamp and ingestion timestamp;
- freshness state;
- observation mode: live, delayed, modeled, or reconstructed;
- optional retrieval or attribution reference;
- a JSON-safe selected observation snapshot.

It should not mention EPICON, Mobius confidence policy, witness governance,
dispute lanes, or civic protocol concepts. Those remain in the isolated Mobius
package.

The upstream API should also respect provider storage rules. “Provenance” does
not imply permission to persist the provider payload.

## Phased recommendation

### Phase 2 — isolated package

- Create the package boundaries above.
- Define plain adapter input and EPICON output contracts.
- Implement deterministic canonicalization/hash tests and local-store tests.
- Do not attach to the renderer yet and do not modify a core layer.

### Phase 3 — earthquake proof of concept

- Add the one composition-root attachment.
- Resolve only earthquake entity picks.
- Snapshot values already present on the picked entity.
- Require an exact match against the last manager-confirmed accepted snapshot.
- Generate one EPICON packet per accepted user observation.
- Append locally and expose a local read/export path.
- Do not change the earthquake ellipse, label, camera, or layer lifecycle.

### Phase 4 — replay and audit

- Read locally stored packets.
- Verify hashes and schema versions.
- Report audit results without presenting old data as live.
- Demonstrate deterministic replay in tests and a local-only operator flow.

Multi-agent witnesses, ZEUS, EVE, HERMES, OAA, Academy exports, network
evidence services, and confidence evolution remain explicitly out of scope.

## Decision summary

- **Cleanest existing data seam:** the earthquake layer’s JSON-safe
  `getAnalystRecords()` projection, used through an explicit adapter contract.
- **Cleanest existing timing seam:** `DataLayerManager.subscribe()`, with the
  caveat that it emits no records and treats initial enable differently from a
  recurring refresh.
- **Smallest PoC click seam:** an adapter-owned, earthquake-only pick listener
  attached at the composition root.
- **Best generic upstream proposal:** provider-neutral observation provenance
  and selection publication.
- **Separation rule:** GEV owns acquisition, interaction, and rendering; Mobius
  copies normalized observations into EPICON and owns local replay/audit.
- **Divergence rule:** no globe rewrite, no manager monkey-patch, no
  EPICON-specific fields in core GEV entities, and no provider payload
  persistence beyond its terms.
