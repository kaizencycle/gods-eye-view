import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { flyToAustin } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import satellitesLayer from './data/satellites.js';
import rocketLaunchesLayer from './data/rocketLaunches.js';
import trafficLayer from './data/traffic.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import bikeshareLayer from './data/bikeshare.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import localDataLayers from './data/localLayers.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initGevVoiceCommands } from './voice/gevRealtime.js';
import { MapStackController } from './mapStackController.js';
import { initAnnotations } from './annotations/index.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import { registerPickOwner, unregisterPickOwner } from './data/pickRegistry.js';
import {
  bindTrackingClickGesture,
  isTrackingSelectionGesture,
} from './data/trackingClickGesture.js';
import { attachMobiusAdapter } from '../packages/mobius-integrity/index.js';
import {
  normalizeTerminalPollMs,
  TerminalBridge,
} from '../packages/mobius-integration/terminalBridge.js';
import { attachPacketVerification } from '../packages/mobius-integration/packetVerification.js';
import { attachInstrumentPanel } from './hud/instrumentPanel.js';
import './hud/instrumentPanel.css';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { initFirstRunExperience } from './firstRunExperience.js';
import {
  applyRendererProfile,
  createRendererRecovery,
  isShaderCompatibilityError,
  isRendererStartupError,
  nextRendererProfile,
  probeRendererCapabilities,
  readRendererNegotiationHistory,
  recordRendererAttempt,
  rendererDiagnostics,
  rendererFailureCategory,
  rendererFallbackUrl,
  rendererProfileForMapKey,
  rendererProfileOverride,
  rendererRequiresRecreation,
  rendererViewerOptions,
  selectRendererProfile,
} from './rendererCompatibility.js';
import { bootStaticWorldFallback } from './staticWorldFallback.js';

initLogoGaze();

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

/**
 * GOD'S EYE VIEW — Main Entry Point
 * Initializes CesiumJS with Google Photorealistic 3D Tiles,
 * style system, intelligence HUD, location presets, and share links.
 */
async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');
  let terminalBridge = null;
  let packetVerification = null;
  let instrumentPanel = null;
  let destroyTerminalIntegration = null;
  let terminalPageHideHandler = null;
  let rendererRecovery = null;
  let rendererProfile = null;
  let rendererStatusHideTimer = null;
  let rendererTerminalFailure = false;
  let tileset = null;
  let styleManager = null;
  let cockpitCloudEffects = null;
  const updateLoaderStatus = (message, { force = false } = {}) => {
    if (rendererTerminalFailure && !force) return;
    loaderStatus.textContent = message;
  };

  try {
    updateLoaderStatus('Configuring viewer...');

    // Set Cesium Ion token for World Terrain
    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
    if (cesiumToken) {
      Cesium.Ion.defaultAccessToken = cesiumToken;
    }

    const rendererCapabilities = probeRendererCapabilities();
    rendererProfile = selectRendererProfile(
      rendererCapabilities,
      rendererProfileOverride(),
    );
    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
    let rendererSelectionReason = 'capability-negotiation';
    if (!googleApiKey && rendererProfile.photoreal) {
      rendererProfile = rendererProfileForMapKey(rendererProfile, false);
      rendererSelectionReason = 'google-map-key-unavailable';
    }
    if (googleApiKey) {
      Cesium.GoogleMaps.defaultApiKey = googleApiKey;
      window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;
    }
    recordRendererAttempt({
      profile: rendererProfile.id,
      status: 'selected',
      reason: rendererSelectionReason,
    });
    if (rendererProfile.id === 'fallback') {
      recordRendererAttempt({
        profile: rendererProfile.id,
        status: 'running',
        reason: 'static-fallback',
      });
      const settledUrl = new URL(window.location.href);
      settledUrl.searchParams.delete('rendererFallback');
      window.history.replaceState(null, '', settledUrl);
      bootStaticWorldFallback({
        reason: rendererCapabilities.webgl2
          ? 'Static fallback profile selected after renderer negotiation.'
          : 'WebGL2 is unavailable; static map mode activated.',
        diagnostics: rendererDiagnostics({
          capabilities: rendererCapabilities,
          profile: rendererProfile,
        }),
        terminalUrl: import.meta.env.VITE_TERMINAL_API_URL
          || 'https://terminal.mobius-substrate.com',
      });
      return;
    }
    const viewerProfileOptions = rendererViewerOptions(rendererProfile, {
      sceneMode2D: Cesium.SceneMode.SCENE2D,
    });

    // Create the Cesium viewer with minimal chrome
    let viewer;
    try {
      viewer = new Cesium.Viewer('cesiumContainer', {
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        vrButton: false,
        selectionIndicator: false,
        infoBox: false,
        baseLayer: false,
        ...viewerProfileOptions,
        // Visible attribution container — Google Maps / 3D Tiles credits are
        // required by Google's Terms of Service, so they must be shown (styled
        // subtly via #cesium-credits). The credit line stays visible in
        // clean-view AND recording modes too (ToS requires attribution while the
        // content is displayed — those are the exact modes used to record
        // demos), including the "Data attribution" link that opens the per-layer
        // license popover.
        creditContainer: (() => {
          const el = document.createElement('div');
          el.id = 'cesium-credits';
          document.body.appendChild(el);
          return el;
        })(),
      });
    } catch (error) {
      recordRendererAttempt({
        profile: rendererProfile.id,
        status: 'failed',
        reason: rendererFailureCategory(error),
      });
      const nextProfile = nextRendererProfile(rendererProfile);
      if (nextProfile) {
        updateLoaderStatus('Optimizing renderer… Switching to compatibility mode…');
        window.location.replace(rendererFallbackUrl(window.location.href, nextProfile.id));
        return;
      }
      throw error;
    }

    applyRendererProfile(viewer, rendererProfile);
    const rendererStatus = document.getElementById('renderer-compat-status');
    const reportRendererStatus = ({
      state,
      profile,
      previousProfile = null,
      error = null,
    }) => {
      if (!rendererStatus) return;
      clearTimeout(rendererStatusHideTimer);
      rendererStatus.dataset.state = state;
      rendererStatus.hidden = false;
      if (state === 'recovering') {
        if (previousProfile) {
          recordRendererAttempt({
            profile: previousProfile,
            status: 'failed',
            reason: rendererFailureCategory(error),
          });
        }
        recordRendererAttempt({
          profile,
          status: 'selected',
          reason: 'fallback',
        });
        rendererStatus.textContent = 'Optimizing renderer… Switching to compatibility mode…';
        updateLoaderStatus(rendererStatus.textContent);
      } else if (state === 'restarted') {
        recordRendererAttempt({ profile, status: 'running', reason: 'restarted' });
        rendererStatus.textContent = `Renderer restarted in ${profile} compatibility mode.`;
        rendererStatusHideTimer = setTimeout(() => {
          rendererStatus.hidden = true;
        }, 4_000);
      } else {
        recordRendererAttempt({
          profile,
          status: 'failed',
          reason: rendererFailureCategory(error),
        });
        rendererTerminalFailure = true;
        rendererStatus.textContent = 'Renderer compatibility mode could not recover this GPU.';
        updateLoaderStatus(rendererStatus.textContent, { force: true });
        loaderStatus.style.color = '#ff8f94';
      }
    };
    rendererRecovery = createRendererRecovery(viewer, {
      initialProfile: rendererProfile,
      applyProfile: (nextProfile) => {
        rendererProfile = nextProfile;
        applyRendererProfile(viewer, nextProfile, {
          tileset,
          styleManager,
        });
        if (!nextProfile.postProcessing) cockpitCloudEffects?.lockCompatibility();
      },
      recreateProfile: (nextProfile, previousProfile) => {
        if (!rendererRequiresRecreation(previousProfile, nextProfile)) return false;
        window.location.replace(rendererFallbackUrl(window.location.href, nextProfile.id));
        return true;
      },
      prepareProfile: (nextProfile) => rendererProfileForMapKey(
        nextProfile,
        Boolean(googleApiKey),
      ),
      onStatus: reportRendererStatus,
      development: import.meta.env.DEV,
    });
    const fallbackMarker = new URLSearchParams(window.location.search).get('rendererFallback');
    if (fallbackMarker === rendererProfile.id) {
      reportRendererStatus({ state: 'restarted', profile: rendererProfile.id });
      const settledUrl = new URL(window.location.href);
      settledUrl.searchParams.delete('rendererFallback');
      window.history.replaceState(null, '', settledUrl);
    }

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe attribution line.
    registerDataCredits(viewer);

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    viewer.scene.globe.show = !rendererProfile.photoreal;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    if (viewer.scene.skyAtmosphere && rendererProfile.atmosphere) {
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
      viewer.scene.skyAtmosphere.saturationShift = -0.12;
      viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    }

    if (rendererProfile.photoreal && googleApiKey) {
      updateLoaderStatus('Loading Google 3D Tiles...');
      try {
        // Load Google Photorealistic 3D Tiles
        tileset = await Cesium.createGooglePhotorealistic3DTileset({
          onlyUsingWithGoogleGeocoder: true,
        });
        viewer.scene.primitives.add(tileset);
        applyRendererProfile(viewer, rendererProfile, { tileset });
        // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
        // Google Photorealistic 3D Tiles provide their own terrain/elevation.
        viewer.scene.globe.show = false;
      } catch (tileError) {
        console.warn('[Init] Google 3D Tiles unavailable, falling back to Cesium globe:', tileError);
        const tileErrorDetail = describeError(tileError);
        updateLoaderStatus(`Google 3D Tiles unavailable (${tileErrorDetail}). Continuing in fallback mode...`);
        // Keep Cesium globe visible as fallback instead of aborting the app.
        viewer.scene.globe.show = true;
      }
    } else {
      updateLoaderStatus(`Loading ${rendererProfile.id} OpenStreetMap renderer...`);
      viewer.scene.globe.show = true;
    }

    updateLoaderStatus('Initializing systems...');

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      initialStack: tileset ? 'photoreal' : 'osm',
      allowTerrain: rendererProfile.terrain,
      // Task 5 (height-datum fix): rebroadcast stack changes as a window
      // CustomEvent so data layers (CCTV per-regime ground resolution) can
      // react without coupling MapStackController to layer modules. Fires on
      // 'switching'/'ready'/'error'; listeners derive the surface regime from
      // live scene state, so intermediate emissions are harmless.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    styleManager = new StyleManager(viewer, {
      mapStackController,
      rendererProfile,
    });
    // The previous multi-canvas weather compositor remains disabled. Cockpit
    // clouds use a separate, capped low-resolution GPU pass that never attaches
    // Cesium fog or post-process stages and is fully stopped in map mode.
    const weatherEffects = null;
    cockpitCloudEffects = rendererProfile.postProcessing
      ? initCockpitCloudEffects(viewer)
      : null;
    if (!cockpitCloudEffects) {
      window.dispatchEvent(new CustomEvent('gev:cockpit-weather-state', {
        detail: { enabled: false, available: false },
      }));
    }

    // If no share link state, do default fly-to Austin
    if (!styleManager.hasShareState) {
      updateLoaderStatus('Flying to Austin, TX...');
      flyToAustin(viewer);
    } else {
      updateLoaderStatus('Restoring shared view...');
    }

    // Initialize data layer manager
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
    });
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(satellitesLayer);
    dataManager.register(rocketLaunchesLayer);
    rocketLaunchesLayer.attachDataManager(dataManager);
    dataManager.register(trafficLayer);
    dataManager.register(cctvLayer);
    dataManager.register(radioLayer);
    dataManager.register(bikeshareLayer);
    dataManager.register(aisLiveVesselsLayer);
    dataManager.register(militaryInstallationsLayer);
    dataManager.register(militaryAwarenessLayer);
    militaryAwarenessLayer.attachDataManager(dataManager);
    for (const layer of localDataLayers) {
      dataManager.register(layer);
    }
    // Restoration starts only after the complete production registry is sealed.
    dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY);
    if (rendererProfile.sceneMode !== '3d') {
      dataManager.setLayerParams(
        'flights',
        { models3d: false, rendererModelsAllowed: false },
        { origin: 'programmatic' },
      );
      dataManager.setLayerParams(
        'military',
        { models3d: false, rendererModelsAllowed: false },
        { origin: 'programmatic' },
      );
    }
    if (import.meta.env.DEV) {
      window.__gevQaRegisterLayer = (targetManager, layerModule) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.registerForQa(layerModule);
      };
      window.__gevQaUnregisterLayer = (targetManager, layerId) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.unregisterForQa(layerId);
      };
    }
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    const mobiusAdapter = attachMobiusAdapter({
      viewer,
      dataManager,
      source: {
        name: 'USGS',
        getRecords: () => earthquakesLayer.getAnalystRecords(),
      },
      createClickHandler: (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
      bindClickHandler: (handler, onClick) => {
        bindTrackingClickGesture(handler, (click, gesture) => {
          if (isTrackingSelectionGesture(gesture)) onClick(click);
        });
      },
      registerPickOwnership: (predicate) => {
        const ownerId = 'mobius-earthquakes';
        registerPickOwner(ownerId, predicate);
        return () => unregisterPickOwner(ownerId);
      },
    });
    if (import.meta.env.VITE_TERMINAL_INSTRUMENTS_ENABLED === 'true') {
      terminalBridge = new TerminalBridge({
        terminalUrl: import.meta.env.VITE_TERMINAL_API_URL
          || 'https://terminal.mobius-substrate.com',
        pollMs: normalizeTerminalPollMs(import.meta.env.VITE_TERMINAL_POLL_MS),
        liveUpdates: import.meta.env.VITE_TERMINAL_LIVE_UPDATES !== 'false',
        // Browser verification remains disabled unless a same-origin server
        // proxy is explicitly configured. Service credentials never enter Vite.
        verifyEndpoint: import.meta.env.VITE_TERMINAL_VERIFY_ENDPOINT || null,
      });
      packetVerification = attachPacketVerification({
        mobiusAdapter,
        bridge: terminalBridge,
      });
      destroyTerminalIntegration = () => {
        if (terminalPageHideHandler) {
          window.removeEventListener('pagehide', terminalPageHideHandler);
          terminalPageHideHandler = null;
        }
        instrumentPanel?.destroy();
        packetVerification?.destroy();
        terminalBridge?.destroy();
      };
      instrumentPanel = attachInstrumentPanel({
        bridge: terminalBridge,
        verification: packetVerification,
      });
      terminalPageHideHandler = (event) => {
        if (event.persisted !== true) destroyTerminalIntegration?.();
      };
      window.addEventListener('pagehide', terminalPageHideHandler);
      void terminalBridge.initialize().then((connected) => {
        if (connected) console.info('[World] Terminal bridge connected');
        else console.warn('[World] Terminal bridge offline; retaining local EPICON capture');
      });
    }
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    void Promise.all([
      styleManager.initialRestorePromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).finally(() => {
      if (rendererTerminalFailure) return;
      loadingScreen.classList.add('hidden');
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        initFirstRunExperience({ styleManager, dataManager });
      };
      loadingScreen.addEventListener('transitionend', revealFirstRun, { once: true });
      setTimeout(revealFirstRun, 900);
    });

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

    // The follow camera recomputes the tracked target's dead-reckon position
    // every frame — tracking anything is a per-frame animation. (perf wave 2)
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
    // stop the default render loop outright — a hidden canvas repaints for
    // nobody, and browser rAF throttling still lets throttled frames burn
    // GPU. Holder/data state is untouched, so return is seamless: restore
    // the loop, refresh the one DOM surface we gated, render a frame.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden && rendererRecovery?.canRestart() !== false;
      cockpitCloudEffects?.setSuspended?.(hidden);
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    // Apply the CURRENT state too — bootstrap can complete while the tab is
    // already hidden, and waiting for the next transition would leave the
    // loop burning behind a hidden tab. (perf wave 2 fix)
    syncVisibilitySuspension();
    recordRendererAttempt({
      profile: rendererProfile.id,
      status: 'running',
      reason: 'startup-complete',
    });

    window.__godsEyeView = {
      viewer,
      styleManager,
      tileset,
      dataManager,
      sceneDirector,
      mapStackController,
      annotations,
      mobiusAdapter,
      terminalBridge,
      packetVerification,
      instrumentPanel,
      weatherEffects,
      cockpitCloudEffects,
      rendererCapabilities,
      getRendererProfile: () => rendererRecovery?.getProfile?.() || rendererProfile,
      getRendererDiagnostics: () => rendererDiagnostics({
        capabilities: rendererCapabilities,
        profile: rendererRecovery?.getProfile?.() || rendererProfile,
        history: readRendererNegotiationHistory(),
      }),
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    window.__godsEyeView.voiceCommands = initGevVoiceCommands({ viewer, styleManager, dataManager, sceneDirector, annotations });

  } catch (error) {
    destroyTerminalIntegration?.();
    rendererRecovery?.destroy();
    clearTimeout(rendererStatusHideTimer);
    if (rendererProfile && isRendererStartupError(error)) {
      recordRendererAttempt({
        profile: rendererProfile.id,
        status: 'failed',
        reason: rendererFailureCategory(error),
      });
      const nextProfile = nextRendererProfile(rendererProfile);
      if (nextProfile) {
        updateLoaderStatus('Optimizing renderer… Switching to compatibility mode…', {
          force: true,
        });
        window.location.replace(rendererFallbackUrl(window.location.href, nextProfile.id));
        return;
      }
    }
    if (import.meta.env.DEV) {
      console.error("God's Eye View initialization failed:", error);
    } else {
      console.error("God's Eye View initialization failed");
    }
    rendererTerminalFailure = true;
    updateLoaderStatus(isShaderCompatibilityError(error)
      ? 'Renderer initialization failed. Compatibility mode could not start.'
      : `Error: ${describeError(error)}`, { force: true });
    loaderStatus.style.color = '#ff4444';
  }
}

init();
