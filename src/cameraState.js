import * as Cesium from 'cesium';
import {
  GLOBE_VIEW,
  globeViewHeightM,
  setDefaultGlobeView,
} from './locations.js';
import {
  isCameraHomeActive,
  setCameraHomeActive,
} from './cameraHomeState.js';

export const CAMERA_SESSION_STORAGE_KEY = 'gev:camera-session:v1';
export const CAMERA_SESSION_VERSION = 1;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeCameraSession(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (candidate.version !== CAMERA_SESSION_VERSION) return null;
  const latitude = finite(candidate.latitude);
  const longitude = finite(candidate.longitude);
  const heightM = finite(candidate.heightM);
  const headingDeg = finite(candidate.headingDeg);
  const pitchDeg = finite(candidate.pitchDeg);
  const rollDeg = finite(candidate.rollDeg);
  if (latitude === null || latitude < -90 || latitude > 90) return null;
  if (longitude === null || longitude < -180 || longitude > 180) return null;
  if (heightM === null || heightM < 0 || heightM > 100_000_000) return null;
  if (headingDeg === null || pitchDeg === null || rollDeg === null) return null;
  if (pitchDeg < -90 || pitchDeg > 90 || rollDeg < -180 || rollDeg > 180) return null;
  return {
    version: CAMERA_SESSION_VERSION,
    latitude,
    longitude,
    heightM,
    headingDeg: ((headingDeg % 360) + 360) % 360,
    pitchDeg,
    rollDeg,
    ...(candidate.home === true ? { home: true } : {}),
  };
}

export function isCanonicalGlobeCamera(viewer, state) {
  const normalized = normalizeCameraSession(state);
  return Boolean(
    normalized
    && normalized.home === true
    && Math.abs(normalized.latitude - GLOBE_VIEW.latitudeDeg) <= 0.0001
    && Math.abs(normalized.longitude - GLOBE_VIEW.longitudeDeg) <= 0.0001
    && Math.abs(normalized.heightM - globeViewHeightM(viewer)) <= 1000
    && Math.abs(normalized.headingDeg - GLOBE_VIEW.headingDeg) <= 0.1
    && Math.abs(normalized.pitchDeg - GLOBE_VIEW.pitchDeg) <= 0.1
    && Math.abs(normalized.rollDeg - GLOBE_VIEW.rollDeg) <= 0.1,
  );
}

export function adaptCameraSessionForViewer(viewer, state) {
  const normalized = normalizeCameraSession(state);
  if (!normalized) return null;
  if (normalized.home !== true) return normalized;
  return {
    ...normalized,
    latitude: GLOBE_VIEW.latitudeDeg,
    longitude: GLOBE_VIEW.longitudeDeg,
    heightM: globeViewHeightM(viewer),
    headingDeg: GLOBE_VIEW.headingDeg,
    pitchDeg: GLOBE_VIEW.pitchDeg,
    rollDeg: GLOBE_VIEW.rollDeg,
  };
}

export function serializeCameraSession(state) {
  const normalized = normalizeCameraSession(state);
  if (!normalized) throw new TypeError('Invalid camera session');
  return JSON.stringify(normalized);
}

export function parseCameraSession(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return normalizeCameraSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function safeStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function readCameraSession(storage = safeStorage()) {
  try {
    return parseCameraSession(storage?.getItem?.(CAMERA_SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function captureCameraState(viewer) {
  const camera = viewer?.camera;
  const position = camera?.positionCartographic;
  if (!position) return null;
  const state = {
    version: CAMERA_SESSION_VERSION,
    latitude: round(Cesium.Math.toDegrees(position.latitude), 4),
    longitude: round(Cesium.Math.toDegrees(position.longitude), 4),
    heightM: round(position.height, 1),
    headingDeg: round(Cesium.Math.toDegrees(camera.heading), 1),
    pitchDeg: round(Cesium.Math.toDegrees(camera.pitch), 1),
    rollDeg: round(Cesium.Math.toDegrees(camera.roll), 1),
  };
  const normalized = normalizeCameraSession(state);
  if (!normalized) return null;
  return isCameraHomeActive(viewer)
    && isCanonicalGlobeCamera(viewer, { ...normalized, home: true })
    ? { ...normalized, home: true }
    : normalized;
}

export function applyCameraSession(viewer, state) {
  const normalized = adaptCameraSessionForViewer(viewer, state);
  if (!viewer?.camera || !normalized) return false;
  viewer.camera.cancelFlight?.();
  viewer.camera.lookAtTransform?.(Cesium.Matrix4.IDENTITY);
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      normalized.longitude,
      normalized.latitude,
      normalized.heightM,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(normalized.headingDeg),
      pitch: Cesium.Math.toRadians(normalized.pitchDeg),
      roll: Cesium.Math.toRadians(normalized.rollDeg),
    },
  });
  setCameraHomeActive(viewer, normalized.home === true);
  viewer.scene?.requestRender?.();
  return true;
}

export function chooseInitialCamera({ shareState = null, savedState = null } = {}) {
  if (shareState) return { source: 'share', state: null };
  if (savedState) return { source: 'session', state: savedState };
  return { source: 'globe', state: null };
}

export function attachCameraSessionPersistence(viewer, {
  storage = safeStorage(),
  debounceMs = 500,
  startAfter = Promise.resolve(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let destroyed = false;
  let active = false;
  let timer = null;
  let removeCameraListener = null;
  let removeMorphListener = null;
  let resizeListener = null;
  let clearHomeFromInput = null;
  let homeReframePending = false;
  let homeReframeOuterFrame = null;
  let homeReframeInnerFrame = null;
  const schedule = (...args) => setTimer(...args);
  const cancel = (...args) => clearTimer(...args);

  const saveNow = () => {
    if (destroyed || !active || homeReframePending) return false;
    const state = captureCameraState(viewer);
    if (!state) return false;
    try {
      storage?.setItem?.(CAMERA_SESSION_STORAGE_KEY, serializeCameraSession(state));
      return true;
    } catch {
      return false;
    }
  };

  const scheduleSave = () => {
    if (destroyed) return;
    if (timer !== null) cancel(timer);
    timer = schedule(() => {
      timer = null;
      saveNow();
    }, Math.max(0, Number(debounceMs) || 0));
  };

  void Promise.resolve(startAfter).finally(() => {
    if (destroyed) return;
    active = true;
    removeCameraListener = viewer?.camera?.changed?.addEventListener?.(scheduleSave) || null;
    clearHomeFromInput = () => setCameraHomeActive(viewer, false);
    viewer?.canvas?.addEventListener?.('pointerdown', clearHomeFromInput, { passive: true });
    viewer?.canvas?.addEventListener?.('wheel', clearHomeFromInput, { passive: true });
    viewer?.canvas?.addEventListener?.('touchstart', clearHomeFromInput, { passive: true });
    const reframeHomeAfterRendererLayout = () => {
      if (!isCameraHomeActive(viewer) || destroyed || homeReframePending) return;
      homeReframePending = true;
      const requestFrame = globalThis.requestAnimationFrame
        || ((callback) => schedule(callback, 0));
      homeReframeOuterFrame = requestFrame(() => {
        homeReframeOuterFrame = null;
        homeReframeInnerFrame = requestFrame(() => {
          homeReframeInnerFrame = null;
          if (!destroyed && isCameraHomeActive(viewer)) setDefaultGlobeView(viewer);
          homeReframePending = false;
        });
      });
    };
    resizeListener = reframeHomeAfterRendererLayout;
    globalThis.window?.addEventListener?.('resize', resizeListener);
    removeMorphListener = viewer?.scene?.morphComplete?.addEventListener?.(
      reframeHomeAfterRendererLayout,
    ) || null;
  });

  return Object.freeze({
    saveNow,
    destroy({ save = true } = {}) {
      if (destroyed) return;
      if (save) saveNow();
      destroyed = true;
      if (timer !== null) cancel(timer);
      timer = null;
      if (homeReframeOuterFrame !== null) {
        globalThis.cancelAnimationFrame?.(homeReframeOuterFrame);
      }
      if (homeReframeInnerFrame !== null) {
        globalThis.cancelAnimationFrame?.(homeReframeInnerFrame);
      }
      homeReframeOuterFrame = null;
      homeReframeInnerFrame = null;
      homeReframePending = false;
      removeCameraListener?.();
      removeCameraListener = null;
      if (clearHomeFromInput) {
        viewer?.canvas?.removeEventListener?.('pointerdown', clearHomeFromInput);
        viewer?.canvas?.removeEventListener?.('wheel', clearHomeFromInput);
        viewer?.canvas?.removeEventListener?.('touchstart', clearHomeFromInput);
      }
      clearHomeFromInput = null;
      removeMorphListener?.();
      removeMorphListener = null;
      if (resizeListener) globalThis.window?.removeEventListener?.('resize', resizeListener);
      resizeListener = null;
    },
  });
}
