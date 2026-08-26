# Camera Defaults and Restoration

## Canonical global home

World starts from a neutral full-Earth frame:

| Field | Value |
| --- | --- |
| Latitude | `0°` |
| Longitude | `0°` |
| Height | `18,000 km` |
| Heading | `0°` |
| Pitch | `-90°` |
| Roll | `0°` |

`GLOBE_VIEW` in `src/locations.js` is the single source of truth. Startup and
Home/Reset both use it. The 18,000 km height remains inside the application's
global view band and its existing 20,000 km navigation ceiling.

The static non-WebGL fallback likewise opens a global OpenStreetMap frame with
no city marker.

## Startup precedence

Camera authority is resolved exactly once:

```text
valid shared URL camera
  → saved camera session
  → canonical global home
```

### Shared URL

A valid hash containing `lat` and `lon` owns startup. Existing altitude,
heading, pitch, roll, map, visual, panel, and layer restoration behavior is
unchanged. Session state never overwrites the shared destination while initial
restore is pending.

Canonical globe links are projection-aware: a desktop-authored globe view
expands to fit portrait or Cesium 2D, while a 2D-authored globe view returns to
the normal 3D altitude on desktop. Generated Home links carry `home=1`; no
unmarked camera is inferred to be Home, so nearby high-altitude authored views
retain their exact position and orientation.

### Saved session

Bare URLs read `gev:camera-session:v1` from tab-scoped session storage. The
state survives refreshes in the same tab and is discarded when that tab
session ends. The state contains:

```json
{
  "version": 1,
  "latitude": 51.5,
  "longitude": -0.12,
  "heightM": 1200,
  "headingDeg": 20,
  "pitchDeg": -35,
  "rollDeg": 0
}
```

Canonical Home adds `"home": true`. The semantic marker survives responsive
resize and renderer scene-mode changes, then clears on explicit or manual
camera navigation. Approximate coordinates are never inferred to mean Home.

Coordinates are rounded to four decimals (roughly neighborhood/building scale),
height and orientation are similarly reduced, and every value is bounded
before use. Invalid, unavailable, or privacy-blocked storage
fails closed to global home. Persistence starts only after shared restore
authority settles, preventing the pre-restore camera from replacing the shared
view. Camera changes are saved on a short debounce and once more on ordinary
page exit. There is no indefinite camera-location retention.

### Global default

When neither URL nor session state exists, startup immediately applies the
canonical globe with no city-coupled layer or selection.

## Home behavior

The persistent Reset Globe control, Cockpit reset, and voice
`zoom_to_globe` route all call `flyToGlobeView()`. The route:

- releases camera/tracking owners;
- returns to the world frame;
- centers on `0°, 0°`;
- uses the canonical height and orientation;
- retains the existing subtle 2.8-second transition.

Home does not return to Austin or preserve the last sub-camera point.

## Mobile

The same neutral center is used for desktop, phone, and tablet. Camera height
expands on portrait viewports so the Earth is not clipped horizontally.
Cesium 2D uses a world-width orthographic height rather than the 3D altitude.
Physical iPhone/iPad validation remains required for final safe-area and Metal
coverage.

## Scope

This camera policy does not enable layers, generate EPICON packets, alter
renderer negotiation, or couple startup to a city.
