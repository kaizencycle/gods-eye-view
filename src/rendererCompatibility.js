const PROFILE_ORDER = Object.freeze([
  'ultra',
  'high',
  'balanced',
  'mobile',
  'minimal',
  'fallback',
]);
export const RENDERER_NEGOTIATION_STORAGE_KEY = 'gev:renderer-negotiation:v1';

export const RENDERER_PROFILES = Object.freeze({
  ultra: Object.freeze({
    id: 'ultra',
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
    sceneMode: '3d',
    photoreal: true,
    terrain: true,
  }),
  high: Object.freeze({
    id: 'high',
    atmosphere: true,
    postProcessing: true,
    fog: true,
    shadows: false,
    msaaSamples: 2,
    resolutionScale: 1,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: true,
    maximumScreenSpaceError: 2,
    targetFrameRate: 60,
    sceneMode: '3d',
    photoreal: true,
    terrain: true,
  }),
  balanced: Object.freeze({
    id: 'balanced',
    atmosphere: false,
    postProcessing: true,
    fog: false,
    shadows: false,
    msaaSamples: 1,
    resolutionScale: 0.85,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: true,
    maximumScreenSpaceError: 4,
    targetFrameRate: 45,
    sceneMode: '3d',
    photoreal: true,
    terrain: true,
  }),
  mobile: Object.freeze({
    id: 'mobile',
    atmosphere: false,
    postProcessing: false,
    fog: false,
    shadows: false,
    msaaSamples: 1,
    resolutionScale: 0.7,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: false,
    maximumScreenSpaceError: 5,
    targetFrameRate: 30,
    sceneMode: '3d',
    photoreal: true,
    terrain: true,
  }),
  minimal: Object.freeze({
    id: 'minimal',
    atmosphere: false,
    postProcessing: false,
    fog: false,
    shadows: false,
    msaaSamples: 1,
    resolutionScale: 0.6,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: false,
    maximumScreenSpaceError: 8,
    targetFrameRate: 24,
    sceneMode: '2d',
    photoreal: false,
    terrain: false,
  }),
  fallback: Object.freeze({
    id: 'fallback',
    atmosphere: false,
    postProcessing: false,
    fog: false,
    shadows: false,
    msaaSamples: 0,
    resolutionScale: 1,
    orderIndependentTranslucency: false,
    preserveDrawingBuffer: false,
    maximumScreenSpaceError: null,
    targetFrameRate: 0,
    sceneMode: 'static',
    photoreal: false,
    terrain: false,
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

function probeFramebuffer(gl) {
  if (!gl?.createFramebuffer || !gl?.createTexture) return null;
  let framebuffer = null;
  let texture = null;
  try {
    framebuffer = gl.createFramebuffer();
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    return false;
  } finally {
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (texture) gl.deleteTexture(texture);
    } catch {
      // Probe resources are best-effort.
    }
  }
}

function gpuIdentity(gl) {
  try {
    const extension = gl?.getExtension?.('WEBGL_debug_renderer_info');
    if (!extension) return { gpuVendor: null, gpuRenderer: null };
    return {
      gpuVendor: String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) || '') || null,
      gpuRenderer: String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '') || null,
    };
  } catch {
    return { gpuVendor: null, gpuRenderer: null };
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
      framebufferComplete: false,
      instancing: false,
      maxTextureSize: null,
      maxRenderbufferSize: null,
      maxTextureImageUnits: null,
      maxVertexTextureImageUnits: null,
      maxSamples: null,
      deviceMemoryGb: finiteOrNull(navigatorRef?.deviceMemory),
      hardwareConcurrency: finiteOrNull(navigatorRef?.hardwareConcurrency),
      gpuVendor: null,
      gpuRenderer: null,
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
  const webgl1Canvas = documentRef?.createElement?.('canvas');
  let gl1 = null;
  try {
    gl1 = webgl1Canvas?.getContext?.('webgl', attributes)
      || webgl1Canvas?.getContext?.('experimental-webgl', attributes)
      || null;
  } catch {
    gl1 = null;
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
  const identity = gpuIdentity(gl);
  const capabilities = {
    webgl1: Boolean(gl1),
    webgl2: Boolean(gl2),
    fragmentHighPrecision,
    colorBufferFloat: Boolean(gl2?.getExtension?.('EXT_color_buffer_float')),
    floatTextureLinear: Boolean(gl?.getExtension?.('OES_texture_float_linear')),
    framebufferComplete: probeFramebuffer(gl2),
    instancing: Boolean(gl2 || gl?.getExtension?.('ANGLE_instanced_arrays')),
    maxTextureSize: gl ? readLimit(gl, gl.MAX_TEXTURE_SIZE) : null,
    maxRenderbufferSize: gl ? readLimit(gl, gl.MAX_RENDERBUFFER_SIZE) : null,
    maxTextureImageUnits: gl ? readLimit(gl, gl.MAX_TEXTURE_IMAGE_UNITS) : null,
    maxVertexTextureImageUnits: gl ? readLimit(gl, gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) : null,
    maxSamples: gl2 ? readLimit(gl2, gl2.MAX_SAMPLES) : null,
    deviceMemoryGb: finiteOrNull(navigatorRef?.deviceMemory),
    hardwareConcurrency: finiteOrNull(navigatorRef?.hardwareConcurrency),
    ...identity,
  };
  releaseContext(gl2);
  if (gl1 !== gl2) releaseContext(gl1);
  return capabilities;
}

/** Select a renderer profile from measured capability limits. */
export function selectRendererProfile(capabilities = {}, override = null) {
  let requested = typeof override === 'string' ? override.trim().toLowerCase() : '';
  if (requested === 'safe') requested = 'minimal';
  if (Object.hasOwn(RENDERER_PROFILES, requested)) return RENDERER_PROFILES[requested];

  if (!capabilities.webgl2) return RENDERER_PROFILES.fallback;
  if (!capabilities.fragmentHighPrecision
    || capabilities.framebufferComplete === false
    || (capabilities.maxTextureSize !== null && capabilities.maxTextureSize < 4096)
    || (capabilities.maxRenderbufferSize !== null && capabilities.maxRenderbufferSize < 4096)
    || capabilities.maxVertexTextureImageUnits === 0) {
    return RENDERER_PROFILES.minimal;
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
  if ((capabilities.deviceMemoryGb !== null && capabilities.deviceMemoryGb <= 12)
    || (capabilities.maxSamples !== null && capabilities.maxSamples < 8)) {
    return RENDERER_PROFILES.high;
  }
  return RENDERER_PROFILES.ultra;
}

export function rendererProfileOverride(search = globalThis.location?.search || '') {
  try {
    return new URLSearchParams(search).get('rendererProfile');
  } catch {
    return null;
  }
}

export function rendererProfileForMapKey(profile, hasGoogleMapKey) {
  if (!profile || hasGoogleMapKey || profile.photoreal === false) return profile;
  return Object.freeze({
    ...profile,
    photoreal: false,
  });
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
    || current.preserveDrawingBuffer !== next.preserveDrawingBuffer
    || current.sceneMode !== next.sceneMode
    || current.photoreal !== next.photoreal
    || current.terrain !== next.terrain;
}

export function rendererFallbackUrl(href, profileId) {
  const url = new URL(href);
  url.searchParams.set('rendererProfile', profileId);
  url.searchParams.set('rendererFallback', profileId);
  return url.href;
}

export function rendererFailureCategory(error) {
  const message = String(error?.message || error || '');
  if (/atmosphere|computeAtmosphereScattering/i.test(message)) return 'atmosphere-shader';
  if (/shader|program failed to link|compile|\bMSL\b|\bANGLE\b/i.test(message)) {
    return 'shader-compiler';
  }
  if (/context|webgl/i.test(message)) return 'webgl-context';
  return 'render-failure';
}

function safeSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function readRendererNegotiationHistory(storage = safeSessionStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(RENDERER_NEGOTIATION_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => (
      entry
      && typeof entry.profile === 'string'
      && typeof entry.status === 'string'
      && Number.isFinite(entry.at)
    )).slice(-24);
  } catch {
    return [];
  }
}

export function recordRendererAttempt(entry, {
  storage = safeSessionStorage(),
  now = () => Date.now(),
} = {}) {
  const profile = String(entry?.profile || '');
  const status = String(entry?.status || '');
  if (!Object.hasOwn(RENDERER_PROFILES, profile) || !status) return [];
  const history = readRendererNegotiationHistory(storage);
  history.push({
    profile,
    status,
    reason: entry?.reason ? String(entry.reason) : null,
    at: now(),
  });
  const bounded = history.slice(-24);
  try {
    storage?.setItem?.(RENDERER_NEGOTIATION_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Negotiation telemetry is local and best-effort.
  }
  return bounded;
}

export function rendererDiagnostics({
  capabilities,
  profile,
  history = readRendererNegotiationHistory(),
  navigatorRef = globalThis.navigator,
} = {}) {
  return {
    browser: String(navigatorRef?.userAgent || 'unavailable'),
    platform: String(navigatorRef?.platform || 'unavailable'),
    gpuVendor: capabilities?.gpuVendor ?? null,
    gpuRenderer: capabilities?.gpuRenderer ?? null,
    webgl1: capabilities?.webgl1 === true,
    webgl2: capabilities?.webgl2 === true,
    selectedProfile: profile?.id || 'fallback',
    disabledFeatures: Object.entries({
      atmosphere: profile?.atmosphere,
      postProcessing: profile?.postProcessing,
      fog: profile?.fog,
      shadows: profile?.shadows,
      photoreal: profile?.photoreal,
      terrain: profile?.terrain,
    }).filter(([, enabled]) => enabled === false).map(([name]) => name),
    capabilities: { ...(capabilities || {}) },
    history: history.map((entry) => ({ ...entry })),
  };
}

/** Cesium Viewer options that must be chosen before context creation. */
export function rendererViewerOptions(profile, { sceneMode2D = undefined } = {}) {
  const selected = profile || RENDERER_PROFILES.minimal;
  return {
    msaaSamples: selected.msaaSamples,
    skyAtmosphere: selected.atmosphere ? undefined : false,
    orderIndependentTranslucency: selected.orderIndependentTranslucency,
    shadows: selected.shadows,
    showRenderLoopErrors: false,
    ...(selected.sceneMode === '2d' && sceneMode2D !== undefined
      ? { sceneMode: sceneMode2D }
      : {}),
    contextOptions: {
      webgl: {
        preserveDrawingBuffer: selected.preserveDrawingBuffer,
        ...(['mobile', 'minimal'].includes(selected.id)
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

export function nextRendererProfile(current) {
  const index = PROFILE_ORDER.indexOf(current.id);
  return index >= 0 && index < PROFILE_ORDER.length - 1
    ? RENDERER_PROFILES[PROFILE_ORDER[index + 1]]
    : null;
}

export function isShaderCompatibilityError(error) {
  return /shader|program failed to link|compile|\bMSL\b|\bANGLE\b|computeAtmosphereScattering/i
    .test(String(error?.message || error || ''));
}

export function isRendererStartupError(error) {
  return isShaderCompatibilityError(error)
    || /webgl|graphics context|framebuffer|post-process|post process|renderer initialization/i
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
  prepareProfile = (profile) => profile,
  development = false,
  setTimer = globalThis.setTimeout,
} = {}) {
  if (!viewer?.scene?.renderError?.addEventListener) {
    throw new TypeError('Renderer recovery requires scene.renderError');
  }
  let profile = initialProfile || RENDERER_PROFILES.minimal;
  let destroyed = false;
  let exhausted = false;
  let recoveryPending = false;
  const schedule = (...args) => setTimer(...args);

  const publishStatus = (status) => {
    try {
      onStatus(status);
    } catch (error) {
      if (development) console.warn('[Renderer] Status listener failed:', error);
    }
  };

  const negotiate = (scene, error) => {
    if (destroyed || exhausted || recoveryPending) return;
    const candidate = nextRendererProfile(profile);
    if (!candidate) {
      exhausted = true;
      publishStatus({ state: 'failed', profile: profile.id, error });
      if (development) console.error('[Renderer] Compatibility fallback exhausted:', error);
      return;
    }
    recoveryPending = true;
    const previousProfile = profile;
    profile = candidate;
    try {
      profile = prepareProfile(candidate, previousProfile) || candidate;
      publishStatus({
        state: 'recovering',
        profile: profile.id,
        previousProfile: previousProfile.id,
        error,
      });
      if (development) {
        console.warn(`[Renderer] Falling back to ${profile.id}:`, error);
      }
      if (recreateProfile(profile, previousProfile) === true) return;
      applyProfile(profile);
      schedule(() => {
        if (destroyed) return;
        try {
          viewer.useDefaultRenderLoop = true;
          scene.requestRender?.();
          recoveryPending = false;
          publishStatus({ state: 'restarted', profile: profile.id, error: null });
        } catch (restartError) {
          recoveryPending = false;
          negotiate(scene, restartError);
        }
      }, 0);
    } catch (fallbackError) {
      recoveryPending = false;
      negotiate(scene, fallbackError);
    }
  };

  const removeListener = viewer.scene.renderError.addEventListener((scene, error) => {
    negotiate(scene, error);
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
