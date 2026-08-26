# Renderer Capability Negotiation

**Cycle:** C-411

**Status:** Architecture contract for progressive renderer startup

## Goal

Every supported device receives the highest renderer tier it can sustain.
Negotiation must never stop after one compatibility attempt.

```text
ultra → high → balanced → mobile → minimal → fallback
```

The first four tiers use the normal 3D Cesium scene with progressively fewer
GPU features. `minimal` reconstructs Cesium in 2D with OpenStreetMap and no
3D tiles or terrain. `fallback` does not create a WebGL context; it mounts a
static OpenStreetMap shell with search and context links.

## Existing baseline

PR #4 introduced capability probing, `high`/`balanced`/`mobile`/`safe`
profiles, sanitized render errors, and profile-pinned reconstruction when OIT
or preserved-buffer settings change.

The remaining gap is terminal negotiation: a failed `safe` profile latches a
renderer error. This change replaces that stop with `minimal`, then `fallback`.
The old `safe` query override remains an alias for `minimal`.

## Capability report

The probe is feature-based. User-agent data may appear in a local developer
diagnostic report but never participates in profile selection.

Measured fields:

- WebGL1 and WebGL2 context creation
- Fragment `highp` precision
- Complete framebuffer creation
- `EXT_color_buffer_float`
- `OES_texture_float_linear`
- Instancing support
- Texture, renderbuffer, texture-unit, vertex-texture, and MSAA limits
- Device-memory and logical-processor hints when available
- Unmasked GPU vendor/renderer when the debug extension is exposed

The temporary probe context and all probe resources are released.

## Profiles

| Tier | Scene | Atmosphere/Post-FX | OIT | MSAA | Scale | Map |
| --- | --- | --- | --- | --- | --- | --- |
| `ultra` | 3D | enabled | enabled | 4 | 1.0 | Photoreal |
| `high` | 3D | enabled | disabled | 2 | 1.0 | Photoreal |
| `balanced` | 3D | atmosphere off, styles available | disabled | 1 | 0.85 | Photoreal |
| `mobile` | 3D | disabled | disabled | 1 | 0.7 | Photoreal |
| `minimal` | 2D | disabled | disabled | 1 | 0.6 | OSM, flat |
| `fallback` | DOM | unavailable | unavailable | unavailable | CSS | OSM embed |

Full-capability desktop selects `ultra`, preserving the prior desktop
configuration. A valid `?rendererProfile=<tier>` override is available for
diagnostics. `rendererFallback=<tier>` is an internal one-load marker used to
announce successful reconstruction.

## Negotiation

Each attempt is recorded locally:

```text
profile selected
  → running
  → failed (sanitized category)
  → next profile selected
  → reconstruct if construction settings changed
  → running
```

The history is stored in session storage only. It is never sent to Terminal or
another network service.

Construction-only changes—including OIT, preserved drawing buffers, scene
mode, and the switch away from Google 3D Tiles—use `location.replace` with the
camera/share hash preserved. Profile pinning prevents reload loops.

## Minimal mode

`minimal` still requires a usable WebGL2 context, but avoids the reported
high-complexity paths:

- Cesium starts directly in `SCENE2D`
- Sky atmosphere disabled at construction
- Google Photorealistic 3D Tiles skipped
- OSM imagery selected
- Flat ellipsoid terrain (no terrain mesh fetch)
- OIT, post-processing, bloom, sharpen, fog, shadows, and cockpit clouds off
- One MSAA sample and reduced resolution
- 3D aircraft models disabled

Existing Cesium-backed layers, search, annotations, and context UI remain
available where their geometry supports 2D.

## Non-WebGL fallback

If WebGL2 cannot be created or `minimal` still fails, World mounts a DOM
fallback:

- Global OpenStreetMap embed
- Search links to OpenStreetMap
- Context describing renderer status and diagnostics
- Links to reload each supported renderer tier
- Existing Terminal link and source attribution

This shell intentionally does **not** claim live events or layers. Those layers
are Cesium entity/primitive implementations and require WebGL. Delivering live
events without WebGL requires a future independent 2D layer renderer; silently
showing stale or fabricated markers would violate the observation/integrity
boundary.

## User diagnostics

Production surfaces only:

```text
Optimizing renderer…
Switching to compatibility mode…
Renderer restarted in minimal mode.
Static map mode active.
```

The developer report includes:

- browser and platform strings (diagnostics only)
- GPU vendor/renderer
- WebGL capability fields
- selected/current profile
- disabled features
- attempt history
- sanitized failure category

Raw MSL, ANGLE, GLSL, and shader compiler output remains development-only.

## Browser matrix

| Target | Expected negotiation | Required evidence |
| --- | --- | --- |
| iPhone Safari | mobile or minimal; fallback if WebGL2 fails | Physical device |
| iPad Safari | balanced/mobile/minimal | Physical device |
| Chrome Android | balanced/mobile | Physical device |
| Chrome desktop | ultra/high | Automated + manual |
| Firefox desktop | ultra/high/balanced | Manual |
| Edge desktop | ultra/high | Manual |

For every target verify a usable renderer or static fallback, no blank screen,
no raw GPU error, navigation/search availability, and correct diagnostic tier.

## Scope

Renderer negotiation only. No EPICON, replay, witnesses, AI, authentication,
ledger, or agent orchestration changes.
