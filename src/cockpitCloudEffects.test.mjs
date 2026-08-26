import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CockpitCloudEffectsController,
  cockpitCloudRenderSize,
  cockpitWeatherRefreshDue,
  cockpitWeatherEnabledFromStoredValue,
  cockpitWeatherControlState,
  cockpitWeatherRendererAllowed,
} from './cockpitCloudEffects.js';

test('cockpit cloud framebuffer stays low resolution on large displays', () => {
  assert.deepEqual(cockpitCloudRenderSize(2048, 1152), { width: 520, height: 293 });
  assert.deepEqual(cockpitCloudRenderSize(1280, 720), { width: 520, height: 293 });
});

test('cockpit cloud framebuffer never upscales or collapses to zero', () => {
  assert.deepEqual(cockpitCloudRenderSize(640, 360), { width: 269, height: 151 });
  assert.deepEqual(cockpitCloudRenderSize(0, Number.NaN), { width: 1, height: 1 });
});

test('cockpit weather defaults off and enables only from an explicit saved opt-in', () => {
  assert.equal(cockpitWeatherEnabledFromStoredValue(null), false);
  assert.equal(cockpitWeatherEnabledFromStoredValue(''), false);
  assert.equal(cockpitWeatherEnabledFromStoredValue('0'), false);
  assert.equal(cockpitWeatherEnabledFromStoredValue('1'), true);
});

test('renderer compatibility lock permanently blocks cockpit cloud startup', () => {
  assert.equal(cockpitWeatherRendererAllowed(false), true);
  assert.equal(cockpitWeatherRendererAllowed(true), false);
});

test('compatibility renderer disables and labels cockpit weather control', () => {
  assert.deepEqual(cockpitWeatherControlState(true, false), {
    active: false,
    disabled: true,
    label: 'Cockpit weather effects unavailable in compatibility renderer',
    value: 'UNAVAILABLE',
  });
});

test('cockpit weather refreshes after time or meaningful movement', () => {
  const anchor = { latitude: 30, longitude: -97 };
  assert.equal(cockpitWeatherRefreshDue({
    nowMs: 1000,
    fetchedAt: 500,
    anchor,
    point: anchor,
    hasWeather: false,
  }), true);
  assert.equal(cockpitWeatherRefreshDue({
    nowMs: 60_000,
    fetchedAt: 0,
    anchor,
    point: { latitude: 30.01, longitude: -97 },
    hasWeather: true,
  }), false);
  assert.equal(cockpitWeatherRefreshDue({
    nowMs: 5 * 60_000,
    fetchedAt: 0,
    anchor,
    point: anchor,
    hasWeather: true,
  }), true);
  assert.equal(cockpitWeatherRefreshDue({
    nowMs: 60_000,
    fetchedAt: 0,
    anchor,
    point: { latitude: 30.3, longitude: -97 },
    hasWeather: true,
  }), true);
});

test('cloud shader failure latches compatibility and does not retry or leak raw logs', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalWarn = console.warn;
  let contextRequests = 0;
  let deletedShaders = 0;
  let lostContexts = 0;
  const warnings = [];
  const gl = {
    VERTEX_SHADER: 1,
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => false,
    getShaderInfoLog: () => 'RAW MSL COMPILER OUTPUT',
    deleteShader: () => {
      deletedShaders++;
    },
    getExtension: (name) => (name === 'WEBGL_lose_context'
      ? { loseContext: () => { lostContexts++; } }
      : null),
  };
  const canvas = {
    dataset: {},
    classList: { remove() {} },
    setAttribute() {},
    getContext() {
      contextRequests++;
      return gl;
    },
    remove() {},
  };
  try {
    globalThis.document = {
      createElement: () => canvas,
      body: {
        appendChild() {},
        classList: { contains: () => false },
      },
    };
    globalThis.window = {
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      clearTimeout() {},
    };
    globalThis.localStorage = {
      getItem: () => null,
      setItem() {},
    };
    globalThis.CustomEvent = class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    };
    console.warn = (...args) => warnings.push(args.join(' '));
    const controller = new CockpitCloudEffectsController({});

    controller.initializeRenderer();
    controller.start();

    assert.equal(controller.compatibilityLocked, true);
    assert.equal(contextRequests, 1);
    assert.equal(deletedShaders, 1);
    assert.equal(lostContexts, 1);
    assert.deepEqual(warnings, ['[Cockpit clouds] Renderer unavailable']);
    controller.destroy();
  } finally {
    console.warn = originalWarn;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = originalCustomEvent;
  }
});
