import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyRendererProfile,
  createRendererRecovery,
  probeRendererCapabilities,
  rendererFallbackUrl,
  rendererFogEnabled,
  rendererRequiresRecreation,
  rendererViewerOptions,
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
  const { gl, lose } = createGl();
  const canvas = {
    getContext: (name) => (name === 'webgl2' ? gl : null),
  };
  const capabilities = probeRendererCapabilities({
    documentRef: { createElement: () => canvas },
    navigatorRef: { deviceMemory: 8, hardwareConcurrency: 6 },
  });

  assert.equal(capabilities.webgl2, true);
  assert.equal(capabilities.fragmentHighPrecision, true);
  assert.equal(capabilities.colorBufferFloat, true);
  assert.equal(capabilities.maxTextureSize, 16384);
  assert.equal(capabilities.deviceMemoryGb, 8);
  assert.equal(lose.lost, true);
});

test('profile selection is capability-derived and fail-closed', () => {
  assert.equal(selectRendererProfile(fullCapabilities()).id, 'high');
  assert.equal(selectRendererProfile(fullCapabilities({ deviceMemoryGb: 6 })).id, 'balanced');
  assert.equal(selectRendererProfile(fullCapabilities({ colorBufferFloat: false })).id, 'mobile');
  assert.equal(selectRendererProfile(fullCapabilities({ fragmentHighPrecision: false })).id, 'safe');
  assert.equal(selectRendererProfile(fullCapabilities({ webgl2: false })).id, 'safe');
});

test('valid operator override wins while unknown values are ignored', () => {
  assert.equal(selectRendererProfile(fullCapabilities(), 'safe').id, 'safe');
  assert.equal(selectRendererProfile(fullCapabilities(), 'invented').id, 'high');
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

test('applying safe profile disables shader-heavy scene features', () => {
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
  const profile = selectRendererProfile(fullCapabilities(), 'safe');

  applyRendererProfile(viewer, profile, {
    tileset,
    styleManager: {
      applyRendererProfile(next) {
        styleProfile = next.id;
      },
    },
  });

  assert.equal(viewer.resolutionScale, 0.6);
  assert.equal(viewer.targetFrameRate, 30);
  assert.equal(viewer.scene.skyAtmosphere.show, false);
  assert.equal(viewer.scene.msaaSamples, 1);
  assert.equal(viewer.scene.postProcessStages.fxaa.enabled, false);
  assert.equal(viewer.scene.postProcessStages.ambientOcclusion.enabled, false);
  assert.equal(viewer.scene.postProcessStages.bloom.enabled, false);
  assert.equal(viewer.scene.fog.enabled, false);
  assert.equal(viewer.scene.shadowMap.enabled, false);
  assert.equal(tileset.maximumScreenSpaceError, 8);
  assert.equal(styleProfile, 'safe');
});

test('atmosphere shader errors drop directly to mobile and restart rendering', () => {
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

  assert.equal(recovery.getProfile().id, 'mobile');
  assert.deepEqual(applied, ['mobile']);
  assert.equal(viewer.useDefaultRenderLoop, true);
  assert.equal(viewer.scene.requestRenderCalled, true);
  assert.deepEqual(statuses.map((status) => status.state), ['recovering', 'restarted']);
  recovery.destroy();
});

test('safe-profile shader failure exhausts recovery and blocks external restart', () => {
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
    initialProfile: selectRendererProfile(fullCapabilities(), 'safe'),
    onStatus: (status) => statuses.push(status),
  });

  listener(viewer.scene, new Error('Shader Program failed to link'));

  assert.equal(recovery.canRestart(), false);
  assert.deepEqual(statuses.map((status) => status.state), ['failed']);
});

test('non-shader failures produce a sanitized terminal state instead of silence', () => {
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

  assert.equal(recovery.canRestart(), false);
  assert.equal(statuses[0].state, 'failed');
});

test('mobile and safe profiles never restore previously enabled fog', () => {
  assert.equal(rendererFogEnabled(selectRendererProfile(fullCapabilities()), true), true);
  assert.equal(rendererFogEnabled(selectRendererProfile(fullCapabilities(), 'mobile'), true), false);
  assert.equal(rendererFogEnabled(selectRendererProfile(fullCapabilities(), 'safe'), true), false);
});

test('construction-only context changes require a profile-preserving reload', () => {
  const high = selectRendererProfile(fullCapabilities());
  const balanced = selectRendererProfile(fullCapabilities({ deviceMemoryGb: 6 }));
  const mobile = selectRendererProfile(fullCapabilities(), 'mobile');

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
    initialProfile: selectRendererProfile(fullCapabilities()),
    applyProfile: () => {},
    recreateProfile: () => true,
    setTimer: (callback) => {
      callback();
      return 1;
    },
  });

  listener(viewer.scene, new Error('MSL computeAtmosphereScattering failed'));

  assert.equal(recovery.getProfile().id, 'mobile');
  assert.equal(restarted, false);
  assert.equal(viewer.useDefaultRenderLoop, false);
});
