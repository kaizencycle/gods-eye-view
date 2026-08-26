import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyRendererProfile,
  createRendererRecovery,
  isRendererStartupError,
  nextRendererProfile,
  probeRendererCapabilities,
  readRendererNegotiationHistory,
  recordRendererAttempt,
  rendererDiagnostics,
  rendererFallbackUrl,
  rendererFogEnabled,
  rendererProfileForMapKey,
  rendererRequiresRecreation,
  rendererViewerOptions,
  RENDERER_PROFILES,
  selectRendererProfile,
} from './rendererCompatibility.js';

function fullCapabilities(overrides = {}) {
  return {
    webgl1: true,
    webgl2: true,
    fragmentHighPrecision: true,
    colorBufferFloat: true,
    floatTextureLinear: true,
    maxTextureSize: 16384,
    maxRenderbufferSize: 16384,
    maxTextureImageUnits: 16,
    maxVertexTextureImageUnits: 16,
    maxSamples: 8,
    framebufferComplete: true,
    instancing: true,
    deviceMemoryGb: 16,
    hardwareConcurrency: 8,
    ...overrides,
  };
}

function createGl() {
  const lose = { lost: false, loseContext() { this.lost = true; } };
  const gl = {
    FRAGMENT_SHADER: 1,
    HIGH_FLOAT: 2,
    MAX_TEXTURE_SIZE: 3,
    MAX_RENDERBUFFER_SIZE: 4,
    MAX_TEXTURE_IMAGE_UNITS: 5,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 6,
    MAX_SAMPLES: 7,
    TEXTURE_2D: 8,
    RGBA: 9,
    UNSIGNED_BYTE: 10,
    FRAMEBUFFER: 11,
    COLOR_ATTACHMENT0: 12,
    FRAMEBUFFER_COMPLETE: 13,
    createFramebuffer: () => ({}),
    createTexture: () => ({}),
    bindTexture() {},
    texImage2D() {},
    bindFramebuffer() {},
    framebufferTexture2D() {},
    checkFramebufferStatus: () => 13,
    deleteFramebuffer() {},
    deleteTexture() {},
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getExtension(name) {
      if (name === 'WEBGL_lose_context') return lose;
      return name === 'EXT_color_buffer_float' || name === 'OES_texture_float_linear'
        ? {}
        : null;
    },
    getParameter(parameter) {
      return new Map([
        [3, 16384],
        [4, 16384],
        [5, 16],
        [6, 16],
        [7, 8],
      ]).get(parameter);
    },
  };
  return { gl, lose };
}

test('capability probe reads WebGL2 limits and releases its temporary context', () => {
  const { gl: gl2, lose: lose2 } = createGl();
  const { gl: gl1, lose: lose1 } = createGl();
  let canvasCount = 0;
  const canvases = [
    { getContext: (name) => (name === 'webgl2' ? gl2 : null) },
    { getContext: (name) => (name === 'webgl' ? gl1 : null) },
  ];
  const capabilities = probeRendererCapabilities({
    documentRef: { createElement: () => canvases[canvasCount++] },
    navigatorRef: { deviceMemory: 8, hardwareConcurrency: 6 },
  });

  assert.equal(capabilities.webgl1, true);
  assert.equal(capabilities.webgl2, true);
  assert.equal(capabilities.fragmentHighPrecision, true);
  assert.equal(capabilities.colorBufferFloat, true);
  assert.equal(capabilities.instancing, true);
  assert.equal(capabilities.framebufferComplete, true);
  assert.equal(capabilities.maxTextureSize, 16384);
  assert.equal(capabilities.deviceMemoryGb, 8);
  assert.equal(lose2.lost, true);
  assert.equal(lose1.lost, true);
});

test('profile selection is capability-derived and fail-closed', () => {
  assert.equal(selectRendererProfile(fullCapabilities()).id, 'ultra');
  assert.equal(selectRendererProfile(fullCapabilities({ deviceMemoryGb: 6 })).id, 'balanced');
  assert.equal(selectRendererProfile(fullCapabilities({ colorBufferFloat: false })).id, 'mobile');
  assert.equal(selectRendererProfile(fullCapabilities({ fragmentHighPrecision: false })).id, 'minimal');
  assert.equal(selectRendererProfile(fullCapabilities({ webgl2: false })).id, 'fallback');
});

test('valid operator override wins while unknown values are ignored', () => {
  assert.equal(selectRendererProfile(fullCapabilities(), 'safe').id, 'minimal');
  assert.equal(selectRendererProfile(fullCapabilities(), 'invented').id, 'ultra');
});

test('missing Google key preserves negotiated 3D tier and selects keyless map', () => {
  const ultra = selectRendererProfile(fullCapabilities());
  const keyless = rendererProfileForMapKey(ultra, false);

  assert.equal(keyless.id, 'ultra');
  assert.equal(keyless.sceneMode, '3d');
  assert.equal(keyless.photoreal, false);
  assert.equal(rendererProfileForMapKey(ultra, true), ultra);
});

test('mobile viewer options omit atmosphere and expensive translucency', () => {
  const options = rendererViewerOptions(selectRendererProfile(
    fullCapabilities({ colorBufferFloat: false }),
  ));

  assert.equal(options.msaaSamples, 1);
  assert.equal(options.skyAtmosphere, false);
  assert.equal(options.orderIndependentTranslucency, false);
  assert.equal(options.showRenderLoopErrors, false);
});

test('minimal viewer starts directly in 2D without photoreal features', () => {
  const profile = selectRendererProfile(fullCapabilities(), 'minimal');
  const options = rendererViewerOptions(profile, { sceneMode2D: 'SCENE2D' });

  assert.equal(options.sceneMode, 'SCENE2D');
  assert.equal(options.skyAtmosphere, false);
  assert.equal(options.orderIndependentTranslucency, false);
});

test('applying minimal profile disables shader-heavy scene features', () => {
  let styleProfile = null;
  const tileset = { maximumScreenSpaceError: 2 };
  const viewer = {
    resolutionScale: 1,
    shadows: true,
    scene: {
      msaaSamples: 4,
      skyAtmosphere: { show: true },
      fog: { enabled: true },
      postProcessStages: {
        fxaa: { enabled: true },
        ambientOcclusion: { enabled: true },
        bloom: { enabled: true },
      },
      shadowMap: { enabled: true },
      requestRender() {},
    },
  };
  const profile = selectRendererProfile(fullCapabilities(), 'minimal');

  applyRendererProfile(viewer, profile, {
    tileset,
    styleManager: {
      applyRendererProfile(next) {
        styleProfile = next.id;
      },
    },
  });

  assert.equal(viewer.resolutionScale, 0.6);
  assert.equal(viewer.targetFrameRate, 24);
  assert.equal(viewer.scene.skyAtmosphere.show, false);
  assert.equal(viewer.scene.msaaSamples, 1);
  assert.equal(viewer.scene.postProcessStages.fxaa.enabled, false);
  assert.equal(viewer.scene.postProcessStages.ambientOcclusion.enabled, false);
  assert.equal(viewer.scene.postProcessStages.bloom.enabled, false);
  assert.equal(viewer.scene.fog.enabled, false);
  assert.equal(viewer.scene.shadowMap.enabled, false);
  assert.equal(tileset.maximumScreenSpaceError, 8);
  assert.equal(styleProfile, 'minimal');
});

test('renderer failures negotiate one profile at a time and restart rendering', () => {
  let listener = null;
  const applied = [];
  const statuses = [];
  const viewer = {
    useDefaultRenderLoop: false,
    scene: {
      renderError: {
        addEventListener(callback) {
          listener = callback;
          return () => {
            listener = null;
          };
        },
      },
      requestRenderCalled: false,
      requestRender() {
        this.requestRenderCalled = true;
      },
    },
  };
  const recovery = createRendererRecovery(viewer, {
    initialProfile: selectRendererProfile(fullCapabilities()),
    applyProfile: (profile) => applied.push(profile.id),
    onStatus: (status) => statuses.push(status),
    setTimer: (callback) => {
      callback();
      return 1;
    },
  });

  listener(viewer.scene, new Error('MSL computeAtmosphereScattering Program failed to link'));

  assert.equal(recovery.getProfile().id, 'high');
  assert.deepEqual(applied, ['high']);
  assert.equal(viewer.useDefaultRenderLoop, true);
  assert.equal(viewer.scene.requestRenderCalled, true);
  assert.deepEqual(statuses.map((status) => status.state), ['recovering', 'restarted']);
  recovery.destroy();
});

test('non-shader failures also negotiate downward instead of stopping early', () => {
  let listener = null;
  const statuses = [];
  const viewer = {
    scene: {
      renderError: {
        addEventListener(callback) {
          listener = callback;
          return () => {};
        },
      },
    },
  };
  const recovery = createRendererRecovery(viewer, {
    initialProfile: selectRendererProfile(fullCapabilities()),
    onStatus: (status) => statuses.push(status),
  });

  listener(viewer.scene, new Error('Unexpected render invariant'));

  assert.equal(recovery.canRestart(), true);
  assert.equal(recovery.getProfile().id, 'high');
  assert.equal(statuses[0].state, 'recovering');
});

test('fallback application failure advances again instead of stalling pending', () => {
  let listener = null;
  const applied = [];
  const viewer = {
    scene: {
      renderError: {
        addEventListener(callback) {
          listener = callback;
          return () => {};
        },
      },
      requestRender() {},
    },
  };
  const recovery = createRendererRecovery(viewer, {
    initialProfile: RENDERER_PROFILES.ultra,
    applyProfile: (profile) => {
      applied.push(profile.id);
      if (profile.id === 'high') throw new Error('high apply failed');
    },
    setTimer: (callback) => {
      callback();
      return 1;
    },
  });

  listener(viewer.scene, new Error('initial renderer failed'));

  assert.deepEqual(applied, ['high', 'balanced']);
  assert.equal(recovery.getProfile().id, 'balanced');
  assert.equal(recovery.canRestart(), true);
});

test('profile preparation failure advances past the failed candidate', () => {
  let listener = null;
  const prepared = [];
  const viewer = {
    scene: {
      renderError: {
        addEventListener(callback) {
          listener = callback;
          return () => {};
        },
      },
      requestRender() {},
    },
  };
  const recovery = createRendererRecovery(viewer, {
    initialProfile: RENDERER_PROFILES.ultra,
    prepareProfile: (profile) => {
      prepared.push(profile.id);
      if (profile.id === 'high') throw new Error('high preparation failed');
      return profile;
    },
    setTimer: (callback) => {
      callback();
      return 1;
    },
  });

  listener(viewer.scene, new Error('initial renderer failed'));

  assert.deepEqual(prepared, ['high', 'balanced']);
  assert.equal(recovery.getProfile().id, 'balanced');
});

test('mobile and minimal profiles never restore previously enabled fog', () => {
  assert.equal(rendererFogEnabled(selectRendererProfile(fullCapabilities()), true), true);
  assert.equal(rendererFogEnabled(selectRendererProfile(fullCapabilities(), 'mobile'), true), false);
  assert.equal(rendererFogEnabled(selectRendererProfile(fullCapabilities(), 'minimal'), true), false);
});

test('construction-only context changes require a profile-preserving reload', () => {
  const ultra = selectRendererProfile(fullCapabilities(), 'ultra');
  const high = selectRendererProfile(fullCapabilities(), 'high');
  const balanced = selectRendererProfile(fullCapabilities({ deviceMemoryGb: 6 }));
  const mobile = selectRendererProfile(fullCapabilities(), 'mobile');

  assert.equal(rendererRequiresRecreation(ultra, high), true);
  assert.equal(rendererRequiresRecreation(high, balanced), false);
  assert.equal(rendererRequiresRecreation(high, mobile), true);
  const fallbackUrl = new URL(rendererFallbackUrl(
    'https://world.example/?foo=1#lat=30',
    'mobile',
  ));
  assert.equal(fallbackUrl.searchParams.get('rendererProfile'), 'mobile');
  assert.equal(fallbackUrl.searchParams.get('rendererFallback'), 'mobile');
  assert.equal(fallbackUrl.hash, '#lat=30');
});

test('recreated fallback does not restart the incompatible old context', () => {
  let listener = null;
  let restarted = false;
  const viewer = {
    useDefaultRenderLoop: false,
    scene: {
      renderError: {
        addEventListener(callback) {
          listener = callback;
          return () => {};
        },
      },
      requestRender() {
        restarted = true;
      },
    },
  };
  const recovery = createRendererRecovery(viewer, {
    initialProfile: selectRendererProfile(fullCapabilities(), 'mobile'),
    applyProfile: () => {},
    recreateProfile: () => true,
    setTimer: (callback) => {
      callback();
      return 1;
    },
  });

  listener(viewer.scene, new Error('MSL computeAtmosphereScattering failed'));

  assert.equal(recovery.getProfile().id, 'minimal');
  assert.equal(restarted, false);
  assert.equal(viewer.useDefaultRenderLoop, false);
});

test('each negotiated profile retains external keyless constraints', () => {
  let listener = null;
  const keylessUltra = rendererProfileForMapKey(RENDERER_PROFILES.ultra, false);
  const viewer = {
    scene: {
      renderError: {
        addEventListener(callback) {
          listener = callback;
          return () => {};
        },
      },
      requestRender() {},
    },
  };
  const recovery = createRendererRecovery(viewer, {
    initialProfile: keylessUltra,
    prepareProfile: (profile) => rendererProfileForMapKey(profile, false),
    recreateProfile: () => true,
  });

  listener(viewer.scene, new Error('renderer failed'));

  assert.equal(recovery.getProfile().id, 'high');
  assert.equal(recovery.getProfile().photoreal, false);
});

test('profile ladder reaches static fallback and then terminates', () => {
  const ids = [];
  let profile = RENDERER_PROFILES.ultra;
  while (profile) {
    ids.push(profile.id);
    profile = nextRendererProfile(profile);
  }

  assert.deepEqual(ids, ['ultra', 'high', 'balanced', 'mobile', 'minimal', 'fallback']);
});

test('renderer startup classifier advances GPU setup failures but not app logic errors', () => {
  assert.equal(isRendererStartupError(new Error('WebGL framebuffer incomplete')), true);
  assert.equal(isRendererStartupError(new Error('Post-process renderer initialization failed')), true);
  assert.equal(isRendererStartupError(new Error('Data layer returned malformed JSON')), false);
});

test('renderer negotiation telemetry is local, bounded, and diagnostic-only', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  recordRendererAttempt(
    { profile: 'ultra', status: 'failed', reason: 'shader-compiler' },
    { storage, now: () => 10 },
  );
  recordRendererAttempt(
    { profile: 'high', status: 'running', reason: 'restarted' },
    { storage, now: () => 20 },
  );
  const history = readRendererNegotiationHistory(storage);
  const report = rendererDiagnostics({
    capabilities: fullCapabilities({ gpuRenderer: 'Test GPU' }),
    profile: RENDERER_PROFILES.high,
    history,
    navigatorRef: { userAgent: 'Test Browser', platform: 'Test Platform' },
  });

  assert.deepEqual(history.map((entry) => entry.profile), ['ultra', 'high']);
  assert.equal(report.gpuRenderer, 'Test GPU');
  assert.equal(report.selectedProfile, 'high');
  assert.equal(report.browser, 'Test Browser');
});
