# Mobile Rendering Compatibility

**Cycle:** C-411 mobile renderer compatibility

**Status:** Investigation complete; compatibility implementation follows this
document.

## Runtime inventory

The production renderer is a Vite application using CesiumJS. The root
manifest accepts Cesium `^1.124.0`; the current lockfile installation resolves
to **CesiumJS 1.138.0**.

The startup render path is:

```text
Cesium.Viewer
  → WebGL context, MSAA ×4, preserved drawing buffer
  → Google Photorealistic 3D Tiles
  → Cesium SkyAtmosphere
  → optional Cesium/custom post-processing
  → screen-space World Overlay and HUD
```

Relevant implementation points:

| Surface | Current behavior | File |
| --- | --- | --- |
| Cesium context | `msaaSamples: 4`, `preserveDrawingBuffer: true` | `src/main.js` |
| Atmosphere | `SkyAtmosphere.show = true`, intensity 18 | `src/main.js` |
| Globe | Hidden behind Google 3D Tiles; restored on tile failure | `src/main.js` |
| Style shaders | Six custom Cesium post-process stages; disabled at zero intensity | `src/ui.js` |
| Bloom | Cesium built-in stage; disabled by default | `src/ui.js` |
| Sharpen | Custom post-process stage; disabled by default | `src/ui.js` |
| Cockpit clouds | Separate low-resolution WebGL1 canvas; opt-in off; compile failure contained | `src/cockpitCloudEffects.js` |
| Detection/cards | Shared Canvas2D world overlay above Cesium | `src/overlays/worldOverlay.js` |
| Idle GPU use | Request-render governor when no animation owner is active | `src/renderGovernor.js` |

## Observed Safari failure

The reported iOS runtime stops while linking Cesium's atmosphere program:

```text
RuntimeError: Program failed to link
MSL compilation error
ANGLE
computeAtmosphereScattering(...)
```

`computeAtmosphereScattering` belongs to the Cesium atmosphere shader path, not
to EPICON, data layers, or application state. Startup currently forces
`scene.skyAtmosphere.show = true` before the first useful frame, with no
capability profile or render-error recovery. A Metal/ANGLE compiler failure can
therefore stop Cesium's default render loop before the UI becomes usable.

Bloom and custom styles expand the later shader surface, but they are disabled
by default and are not the named startup failure. Cockpit clouds are isolated,
opt-in, and already fail clear.

## Existing compatibility gap

Before this work the application:

- did not probe WebGL2 or required render-target capabilities;
- always requested four MSAA samples;
- always enabled atmospheric scattering;
- had no renderer quality model;
- allowed style/bloom/sharpen activation regardless of GPU profile;
- did not subscribe to `scene.renderError`;
- exposed Cesium's raw render-loop error behavior;
- had no way to restart the loop in a reduced profile.

## Capability probe

Profile selection uses a temporary WebGL2 context and capability values, not a
browser or device user-agent string.

The probe records:

- WebGL2 context creation;
- fragment `highp float` precision;
- `EXT_color_buffer_float`;
- `OES_texture_float_linear`;
- maximum texture and renderbuffer sizes;
- texture-unit and vertex-texture-unit counts;
- maximum MSAA samples;
- logical processor count and device-memory hint when available.

The temporary context is released after probing. A missing WebGL2 context is
reported explicitly; no JavaScript setting can emulate a globe when the
browser cannot supply Cesium's required GPU context.

## Quality profiles

| Profile | Selection | Atmosphere | Post-FX | MSAA | Resolution |
| --- | --- | --- | --- | --- | --- |
| `high` | Full required capabilities and resource budget | On | On | 4 | 1.0 |
| `balanced` | Full shader capabilities with a moderate resource budget | On | On | 2 | 0.9 |
| `mobile` | Limited float/MSAA/resource budget | Off | Off | 1 | 0.75 |
| `safe` | Missing high precision, very small limits, or runtime shader fallback | Off | Off | 1 | 0.6 |

`mobile` and `safe` prioritize a stable globe over atmospheric and
post-processing fidelity. They also disable fog, shadows, bloom, sharpen, and
custom style shader activation.

The automatic profile is capability-derived. A `?rendererProfile=` query value
is available for operator diagnostics and testing; unsupported override values
are ignored.

## Runtime fallback

Capability checks cannot predict every driver/compiler defect. Runtime recovery
therefore remains required:

1. Listen to Cesium `scene.renderError`.
2. Detect shader compilation/link failures without relying on a device name.
3. Apply the next lower profile, ending at `safe`.
4. Disable atmosphere and the complete post-process collection before the next
   frame.
5. Re-enable Cesium's default render loop and request a render.
6. Show a concise compatibility status instead of Cesium's raw shader output.
7. Keep detailed compiler diagnostics in development logs only.

Recovery is bounded: each profile can be entered once, and a repeated failure
in `safe` becomes an honest terminal renderer error rather than a retry loop.

## User-visible diagnostics

The loading surface may show:

```text
Renderer initialization failed. Attempting compatibility mode…
Renderer restarted in compatibility mode.
```

Production text does not include raw GLSL/MSL compiler output. Development
diagnostics expose the selected profile, capabilities, fallback reason, and
original error.

## Browser support and verification matrix

Compatibility claims require real-device evidence. Capability emulation and
desktop responsive mode do not prove Metal shader behavior.

| Browser | Expected path | Verification status |
| --- | --- | --- |
| iPhone Safari | Automatic `mobile` or runtime `safe` fallback | Required on physical device |
| iPad Safari | Automatic profile with runtime fallback | Required on physical device |
| Chrome Android | Automatic profile | Required on physical device |
| Chrome desktop | `high`/`balanced`; existing behavior retained | Automated Chromium coverage |
| Firefox desktop | Automatic profile | Manual coverage required |
| Edge desktop | `high`/`balanced` | Manual coverage required |

For each target verify:

- globe reaches a rendered frame;
- camera pan/zoom/orbit works;
- data layers can be toggled;
- no blank canvas or raw shader dialog appears;
- fallback status matches the active profile;
- desktop high profile retains atmosphere and post-processing controls.

## Performance recommendations

- Keep mobile/safe resolution scale below device pixel ratio.
- Avoid MSAA above one sample in mobile/safe.
- Keep atmosphere and post-processing disabled after fallback.
- Leave cockpit clouds opt-in and low-resolution.
- Preserve request-render mode while idle.
- Limit high-cardinality layers using their existing cohorts and render caps.
- Do not solve a GPU compatibility fault by increasing tile or terrain detail.

## Scope boundary

This work changes renderer startup, quality gating, diagnostics, and recovery
only. It does not change EPICON, replay, witnesses, Terminal integration,
authentication, AI, or data-layer semantics.
