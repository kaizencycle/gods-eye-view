const PROFILE_ORDER = Object.freeze(['high', 'balanced', 'mobile', 'safe']);

export const RENDERER_PROFILES = Object.freeze({
  high: Object.freeze({
    id: 'high',
    atmosphere: true,
    postProcessing: true,
    fog: true,
    shadows: false,
    msaaSamples: 4,
    resolutionScale: 1,
    orderIndependentTranslucency: true,
    preserveDrawingBuffer: true,
    maximumScreenSpaceError: 2,
    targetFrameRate: 60,
  }),
  balanced: Object.freeze({
    id: 'balanced',
    atmosphere: true,
    postProcessing: true,
    fog: true,
    shadows: false,
    msaaSamples: 2,
    resolutionScale: 0.9,
    orderIndependentTranslucency: true,
    preserveDrawingBuffer: true,
    maximumScreenSpaceError: 3,
    targetFrameRate: 45,
  }),
  mobile: Object.freeze({
    id: 'mobile',
    atmosphere: false,
    postProcessing: false,
    fog: false,
    shadows: false,
    msaaSamples: 1,
    resolutionScale: 0.75,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: false,
    maximumScreenSpaceError: 5,
    targetFrameRate: 30,
  }),
  safe: Object.freeze({
    id: 'safe',
    atmosphere: false,
    postProcessing: false,
    fog: false,
    shadows: false,
    msaaSamples: 1,
    resolutionScale: 0.6,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: false,
    maximumScreenSpaceError: 8,
    targetFrameRate: 30,
  }),
});

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readLimit(gl, parameter) {
  try {
    return finiteOrNull(gl.getParameter(parameter));
  } catch {
    return null;
  }
}

function releaseContext(gl) {
  try {
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  } catch {
    // A probe context is best-effort and owns no application resources.
  }
}

/** Probe browser GPU capabilities using a temporary WebGL context. */
export function probeRendererCapabilities({
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
} = {}) {
  const canvas = documentRef?.createElement?.('canvas');
  if (!canvas?.getContext) {
    return {
      webgl1: false,
      webgl2: false,
      fragmentHighPrecision: false,
      colorBufferFloat: false,
      floatTextureLinear: false,
      maxTextureSize: null,
      maxRenderbufferSize: null,
      maxTextureImageUnits: null,
      maxVertexTextureImageUnits: null,
      maxSamples: null,
      deviceMemoryGb: finiteOrNull(navigatorRef?.deviceMemory),
      hardwareConcurrency: finiteOrNull(navigatorRef?.hardwareConcurrency),
    };
  }

  const attributes = {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  };
  let gl2 = null;
  try {
    gl2 = canvas.getContext('webgl2', attributes);
  } catch {
    gl2 = null;
  }
  let gl1 = gl2;
  if (!gl1) {
    try {
      gl1 = canvas.getContext('webgl', attributes)
        || canvas.getContext('experimental-webgl', attributes);
    } catch {
      gl1 = null;
    }
  }
  const gl = gl2 || gl1;
  let fragmentHighPrecision = false;
  try {
    fragmentHighPrecision = Boolean(
      gl?.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision > 0,
    );
  } catch {
    fragmentHighPrecision = false;
  }
  const capabilities = {
    webgl1: Boolean(gl1),
    webgl2: Boolean(gl2),
    fragmentHighPrecision,
    colorBufferFloat: Boolean(gl2?.getExtension?.('EXT_color_buffer_float')),
    floatTextureLinear: Boolean(gl?.getExtension?.('OES_texture_float_linear')),
    maxTextureSize: gl ? readLimit(gl, gl.MAX_TEXTURE_SIZE) : null,
    maxRenderbufferSize: gl ? readLimit(gl, gl.MAX_RENDERBUFFER_SIZE) : null,
    maxTextureImageUnits: gl ? readLimit(gl, gl.MAX_TEXTURE_IMAGE_UNITS) : null,
    maxVertexTextureImageUnits: gl ? readLimit(gl, gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) : null,
    maxSamples: gl2 ? readLimit(gl2, gl2.MAX_SAMPLES) : null,
    deviceMemoryGb: finiteOrNull(navigatorRef?.deviceMemory),
    hardwareConcurrency: finiteOrNull(navigatorRef?.hardwareConcurrency),
  };
  releaseContext(gl);
  return capabilities;
}

/** Select a renderer profile from measured capability limits. */
export function selectRendererProfile(capabilities = {}, override = null) {
  const requested = typeof override === 'string' ? override.trim().toLowerCase() : '';
  if (Object.hasOwn(RENDERER_PROFILES, requested)) return RENDERER_PROFILES[requested];

  if (!capabilities.webgl2
    || !capabilities.fragmentHighPrecision
    || (capabilities.maxTextureSize !== null && capabilities.maxTextureSize < 4096)
    || (capabilities.maxRenderbufferSize !== null && capabilities.maxRenderbufferSize < 4096)
    || capabilities.maxVertexTextureImageUnits === 0) {
    return RENDERER_PROFILES.safe;
  }
  if (!capabilities.colorBufferFloat
    || (capabilities.maxSamples !== null && capabilities.maxSamples < 2)
    || (capabilities.deviceMemoryGb !== null && capabilities.deviceMemoryGb <= 4)
    || (capabilities.maxTextureSize !== null && capabilities.maxTextureSize < 8192)) {
    return RENDERER_PROFILES.mobile;
  }
  if ((capabilities.deviceMemoryGb !== null && capabilities.deviceMemoryGb <= 8)
    || (capabilities.hardwareConcurrency !== null && capabilities.hardwareConcurrency <= 6)
    || (capabilities.maxSamples !== null && capabilities.maxSamples < 4)) {
    return RENDERER_PROFILES.balanced;
  }
  return RENDERER_PROFILES.high;
}

export function rendererProfileOverride(search = globalThis.location?.search || '') {
  try {
    return new URLSearchParams(search).get('rendererProfile');
  } catch {
    return null;
  }
}

export function rendererPostProcessingAllowed(profile) {
  return profile?.postProcessing !== false;
}

export function rendererFogEnabled(profile, requested) {
  return profile?.fog !== false && requested === true;
}

export function rendererRequiresRecreation(current, next) {
  if (!current || !next) return false;
  return current.orderIndependentTranslucency !== next.orderIndependentTranslucency
    || current.preserveDrawingBuffer !== next.preserveDrawingBuffer;
}

export function rendererFallbackUrl(href, profileId) {
  const url = new URL(href);
  url.searchParams.set('rendererProfile', profileId);
  url.searchParams.set('rendererFallback', profileId);
  return url.href;
}

/** Cesium Viewer options that must be chosen before context creation. */
export function rendererViewerOptions(profile) {
  const selected = profile || RENDERER_PROFILES.safe;
  return {
    msaaSamples: selected.msaaSamples,
    skyAtmosphere: selected.atmosphere ? undefined : false,
    orderIndependentTranslucency: selected.orderIndependentTranslucency,
    shadows: selected.shadows,
    showRenderLoopErrors: false,
    contextOptions: {
      webgl: {
        preserveDrawingBuffer: selected.preserveDrawingBuffer,
        ...(['mobile', 'safe'].includes(selected.id)
          ? { powerPreference: 'low-power' }
          : {}),
      },
    },
  };
}

/** Apply runtime-adjustable profile settings to an existing Viewer. */
export function applyRendererProfile(viewer, profile, {
  tileset = null,
  styleManager = null,
} = {}) {
  if (!viewer?.scene || !profile) return false;
  viewer.resolutionScale = profile.resolutionScale;
  viewer.targetFrameRate = profile.targetFrameRate;
  viewer.shadows = profile.shadows;
  const scene = viewer.scene;
  if ('msaaSamples' in scene) scene.msaaSamples = profile.msaaSamples;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = profile.atmosphere;
  if (scene.fog) scene.fog.enabled = profile.fog;
  if (scene.shadowMap) scene.shadowMap.enabled = profile.shadows;
  if (scene.globe && Number.isFinite(profile.maximumScreenSpaceError)) {
    scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError;
  }
  if (!profile.postProcessing && scene.postProcessStages) {
    if (scene.postProcessStages.fxaa) scene.postProcessStages.fxaa.enabled = false;
    if (scene.postProcessStages.ambientOcclusion) {
      scene.postProcessStages.ambientOcclusion.enabled = false;
    }
    if (scene.postProcessStages.bloom) scene.postProcessStages.bloom.enabled = false;
  }
  if (tileset && Number.isFinite(profile.maximumScreenSpaceError)) {
    tileset.maximumScreenSpaceError = profile.maximumScreenSpaceError;
  }
  styleManager?.applyRendererProfile?.(profile);
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.dataset.rendererProfile = profile.id;
  }
  scene.requestRender?.();
  return true;
}

function nextProfile(current, error) {
  const message = String(error?.message || error || '');
  if (/atmosphere|computeAtmosphereScattering|\\bMSL\\b/i.test(message)) {
    if (current.id === 'high' || current.id === 'balanced') return RENDERER_PROFILES.mobile;
  }
  const index = PROFILE_ORDER.indexOf(current.id);
  return index >= 0 && index < PROFILE_ORDER.length - 1
    ? RENDERER_PROFILES[PROFILE_ORDER[index + 1]]
    : null;
}

export function isShaderCompatibilityError(error) {
  return /shader|program failed to link|compile|\\bMSL\\b|\\bANGLE\\b|computeAtmosphereScattering/i
    .test(String(error?.message || error || ''));
}

/**
 * Recover Cesium's stopped default render loop in a lower-complexity profile.
 */
export function createRendererRecovery(viewer, {
  initialProfile,
  applyProfile = (profile) => applyRendererProfile(viewer, profile),
  onStatus = () => {},
  recreateProfile = () => false,
  development = false,
  setTimer = globalThis.setTimeout,
} = {}) {
  if (!viewer?.scene?.renderError?.addEventListener) {
    throw new TypeError('Renderer recovery requires scene.renderError');
  }
  let profile = initialProfile || RENDERER_PROFILES.safe;
  let destroyed = false;
  let exhausted = false;
  let recoveryPending = false;
  const schedule = (...args) => setTimer(...args);

  const removeListener = viewer.scene.renderError.addEventListener((scene, error) => {
    if (destroyed || exhausted || recoveryPending) return;
    if (!isShaderCompatibilityError(error)) {
      exhausted = true;
      onStatus({ state: 'failed', profile: profile.id, error });
      if (development) console.error('[Renderer] Non-shader render failure:', error);
      return;
    }
    const fallback = nextProfile(profile, error);
    if (!fallback) {
      exhausted = true;
      onStatus({ state: 'failed', profile: profile.id, error });
      if (development) console.error('[Renderer] Compatibility fallback exhausted:', error);
      return;
    }
    recoveryPending = true;
    const previousProfile = profile;
    profile = fallback;
    onStatus({ state: 'recovering', profile: profile.id, error });
    if (development) {
      console.warn(`[Renderer] Falling back to ${profile.id}:`, error);
    }
    applyProfile(profile);
    if (recreateProfile(profile, previousProfile) === true) return;
    schedule(() => {
      if (destroyed) return;
      viewer.useDefaultRenderLoop = true;
      scene.requestRender?.();
      recoveryPending = false;
      onStatus({ state: 'restarted', profile: profile.id, error: null });
    }, 0);
  });

  return Object.freeze({
    getProfile: () => profile,
    canRestart: () => !destroyed && !exhausted,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeListener?.();
    },
  });
}
