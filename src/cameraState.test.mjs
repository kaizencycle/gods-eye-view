import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyCameraSession,
  adaptCameraSessionForViewer,
  attachCameraSessionPersistence,
  CAMERA_SESSION_STORAGE_KEY,
  captureCameraState,
  chooseInitialCamera,
  parseCameraSession,
  readCameraSession,
  serializeCameraSession,
  isCanonicalGlobeCamera,
} from './cameraState.js';
import {
  isCameraHomeActive,
  setCameraHomeActive,
} from './cameraHomeState.js';

const saved = Object.freeze({
  version: 1,
  latitude: 51.5,
  longitude: -0.12,
  heightM: 1200,
  headingDeg: 20,
  pitchDeg: -35,
  rollDeg: 0,
});

test('initial camera precedence is shared URL, saved session, then globe', () => {
  assert.deepEqual(
    chooseInitialCamera({ shareState: { lat: 1 }, savedState: saved }),
    { source: 'share', state: null },
  );
  assert.deepEqual(
    chooseInitialCamera({ shareState: null, savedState: saved }),
    { source: 'session', state: saved },
  );
  assert.deepEqual(
    chooseInitialCamera({ shareState: null, savedState: null }),
    { source: 'globe', state: null },
  );
});

test('camera session round-trips a bounded canonical state', () => {
  const serialized = serializeCameraSession(saved);

  assert.deepEqual(parseCameraSession(serialized), saved);
  assert.equal(CAMERA_SESSION_STORAGE_KEY, 'gev:camera-session:v1');
});

test('canonical globe sessions adapt across portrait and Cesium 2D renderers', () => {
  const globe = {
    version: 1,
    latitude: 0,
    longitude: 0,
    heightM: 18000000,
    headingDeg: 360,
    pitchDeg: -90,
    rollDeg: 0,
    home: true,
  };
  const desktopViewer = {
    scene: { canvas: { clientWidth: 1440, clientHeight: 900 } },
  };
  assert.equal(isCanonicalGlobeCamera(desktopViewer, globe), true);
  const portrait = adaptCameraSessionForViewer({
    scene: { canvas: { clientWidth: 390, clientHeight: 844 } },
  }, globe);
  assert.ok(portrait.heightM > 30000000);
  const twoDimensional = adaptCameraSessionForViewer({
    scene: {
      mode: 2,
      canvas: { clientWidth: 1024, clientHeight: 768 },
    },
  }, globe);
  assert.equal(twoDimensional.heightM, 40075000);
});

test('unmarked near-global shared views retain their exact authored pose', () => {
  const authored = {
    version: 1,
    latitude: 0.05,
    longitude: -0.05,
    heightM: 18050000,
    headingDeg: 12,
    pitchDeg: -87,
    rollDeg: 3,
  };
  const adapted = adaptCameraSessionForViewer({
    scene: { canvas: { clientWidth: 390, clientHeight: 844 } },
  }, authored);

  assert.deepEqual(adapted, authored);
});

test('invalid or unsafe camera sessions fail closed', () => {
  assert.equal(parseCameraSession('{bad-json'), null);
  assert.equal(parseCameraSession(JSON.stringify({ ...saved, latitude: 91 })), null);
  assert.equal(parseCameraSession(JSON.stringify({ ...saved, heightM: -1 })), null);
  assert.equal(parseCameraSession(JSON.stringify({ ...saved, version: 2 })), null);
});

test('default persistence is tab-session scoped, not indefinite local storage', () => {
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocalStorage = globalThis.localStorage;
  try {
    globalThis.sessionStorage = {
      getItem: () => serializeCameraSession(saved),
    };
    globalThis.localStorage = {
      getItem: () => assert.fail('camera session must not read localStorage'),
    };

    assert.deepEqual(readCameraSession(), saved);
  } finally {
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSessionStorage;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test('captureCameraState records the current camera in degrees', () => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const viewer = {
    camera: {
      positionCartographic: {
        latitude: radians(12.5),
        longitude: radians(-45.25),
        height: 9876,
      },
      heading: radians(90),
      pitch: radians(-40),
      roll: radians(2),
    },
  };

  assert.deepEqual(captureCameraState(viewer), {
    version: 1,
    latitude: 12.5,
    longitude: -45.25,
    heightM: 9876,
    headingDeg: 90,
    pitchDeg: -40,
    rollDeg: 2,
  });
});

test('applyCameraSession restores an exact saved view', () => {
  const calls = [];
  const viewer = {
    camera: {
      cancelFlight() { calls.push('cancel'); },
      lookAtTransform() { calls.push('world-frame'); },
      setView(options) { calls.push(options); },
    },
    scene: { requestRender() { calls.push('render'); } },
  };

  assert.equal(applyCameraSession(viewer, saved), true);
  assert.equal(calls[0], 'cancel');
  assert.equal(calls[1], 'world-frame');
  assert.equal(typeof calls[2].destination.x, 'number');
  assert.equal(calls.at(-1), 'render');
});

test('camera persistence starts after restore authority settles', async () => {
  let changedListener = null;
  let settleRestore;
  const startAfter = new Promise((resolve) => {
    settleRestore = resolve;
  });
  const writes = [];
  const radians = (degrees) => degrees * Math.PI / 180;
  const viewer = {
    camera: {
      positionCartographic: {
        latitude: radians(1),
        longitude: radians(2),
        height: 3000,
      },
      heading: 0,
      pitch: radians(-90),
      roll: 0,
      changed: {
        addEventListener(listener) {
          changedListener = listener;
          return () => {
            changedListener = null;
          };
        },
      },
    },
  };
  const persistence = attachCameraSessionPersistence(viewer, {
    storage: { setItem: (key, value) => writes.push({ key, value }) },
    startAfter,
    setTimer: (callback) => {
      callback();
      return 1;
    },
    clearTimer() {},
  });
  await Promise.resolve();
  assert.equal(changedListener, null);
  assert.equal(persistence.saveNow(), false);
  assert.equal(writes.length, 0);
  settleRestore();
  await startAfter;
  await Promise.resolve();

  changedListener();

  assert.equal(writes.length, 1);
  assert.equal(parseCameraSession(writes[0].value).latitude, 1);
  persistence.destroy({ save: false });
});

test('camera change alone does not erase Home during renderer-driven resize', async () => {
  let changedListener = null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const viewer = {
    camera: {
      positionCartographic: {
        latitude: 0,
        longitude: 0,
        height: 18000000,
      },
      heading: 0,
      pitch: radians(-90),
      roll: 0,
      changed: {
        addEventListener(listener) {
          changedListener = listener;
          return () => {};
        },
      },
    },
    scene: { canvas: { clientWidth: 1440, clientHeight: 900 } },
  };
  setCameraHomeActive(viewer, true);
  const persistence = attachCameraSessionPersistence(viewer, {
    storage: { setItem() {} },
    setTimer: () => 1,
    clearTimer() {},
  });
  await Promise.resolve();
  await Promise.resolve();
  viewer.camera.positionCartographic.latitude = radians(1);

  changedListener();

  assert.equal(isCameraHomeActive(viewer), true);
  persistence.destroy({ save: false });
});

test('direct pointer input clears Home before Cesium movement thresholds fire', async () => {
  const listeners = new Map();
  const viewer = {
    canvas: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
    camera: {
      positionCartographic: { latitude: 0, longitude: 0, height: 18000000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
      changed: {
        addEventListener: () => () => {},
      },
    },
    scene: { canvas: { clientWidth: 1440, clientHeight: 900 } },
  };
  setCameraHomeActive(viewer, true);
  const persistence = attachCameraSessionPersistence(viewer, {
    storage: { setItem() {} },
  });
  await Promise.resolve();
  await Promise.resolve();

  listeners.get('pointerdown')();

  assert.equal(isCameraHomeActive(viewer), false);
  persistence.destroy({ save: false });
  assert.equal(listeners.size, 0);
});

test('responsive resize reframes semantic Home after renderer layout settles', async () => {
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const listeners = new Map();
  let setViewCalls = 0;
  const viewer = {
    canvas: { addEventListener() {}, removeEventListener() {} },
    camera: {
      positionCartographic: { latitude: 0, longitude: 0, height: 18000000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
      cancelFlight() {},
      lookAtTransform() {},
      setView() { setViewCalls++; },
      changed: { addEventListener: () => () => {} },
    },
    scene: {
      canvas: { clientWidth: 390, clientHeight: 844 },
      requestRender() {},
    },
  };
  try {
    globalThis.window = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    globalThis.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    setCameraHomeActive(viewer, true);
    const persistence = attachCameraSessionPersistence(viewer, {
      storage: { setItem() {} },
    });
    await Promise.resolve();
    await Promise.resolve();

    listeners.get('resize')();

    assert.equal(setViewCalls, 1);
    assert.equal(isCameraHomeActive(viewer), true);
    persistence.destroy({ save: false });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

test('burst resize is coalesced and persistence stays blocked through both frames', async () => {
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const listeners = new Map();
  const frames = [];
  const writes = [];
  let setViewCalls = 0;
  let nextFrameId = 1;
  const viewer = {
    canvas: { addEventListener() {}, removeEventListener() {} },
    camera: {
      positionCartographic: { latitude: 0, longitude: 0, height: 18000000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
      cancelFlight() {},
      lookAtTransform() {},
      setView() { setViewCalls++; },
      changed: { addEventListener: () => () => {} },
    },
    scene: {
      canvas: { clientWidth: 390, clientHeight: 844 },
      requestRender() {},
    },
  };
  try {
    globalThis.window = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    globalThis.requestAnimationFrame = (callback) => {
      const id = nextFrameId++;
      frames.push({ id, callback });
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      const index = frames.findIndex((frame) => frame.id === id);
      if (index >= 0) frames.splice(index, 1);
    };
    setCameraHomeActive(viewer, true);
    const persistence = attachCameraSessionPersistence(viewer, {
      storage: { setItem: (key, value) => writes.push({ key, value }) },
    });
    await Promise.resolve();
    await Promise.resolve();

    listeners.get('resize')();
    listeners.get('resize')();
    assert.equal(frames.length, 1);
    assert.equal(persistence.saveNow(), false);
    frames.shift().callback();
    assert.equal(frames.length, 1);
    assert.equal(persistence.saveNow(), false);
    frames.shift().callback();

    assert.equal(setViewCalls, 1);
    assert.equal(persistence.saveNow(), true);
    assert.equal(writes.length, 1);
    persistence.destroy({ save: false });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
