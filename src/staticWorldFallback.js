const GLOBAL_BOUNDS = '-180,-80,180,80';

export function staticFallbackMapUrl() {
  const params = new URLSearchParams({
    bbox: GLOBAL_BOUNDS,
    layer: 'mapnik',
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

function element(tag, className, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function profileLink(profileId) {
  const url = new URL(window.location.href);
  url.searchParams.set('rendererProfile', profileId);
  url.searchParams.delete('rendererFallback');
  const link = element('a', 'static-world-profile-link', profileId.toUpperCase());
  link.href = url.href;
  return link;
}

/** Mount a non-WebGL map/search/context shell after renderer negotiation ends. */
export function bootStaticWorldFallback({
  reason = 'WebGL renderer unavailable',
  diagnostics = null,
  terminalUrl = 'https://terminal.mobius-substrate.com',
} = {}) {
  const host = document.getElementById('cesiumContainer');
  if (!host) throw new Error('Static fallback host is missing');
  document.body.classList.add('static-world-fallback-active');
  const shell = element('section', 'static-world-fallback');
  shell.id = 'static-world-fallback';

  const header = element('header', 'static-world-fallback-header');
  header.append(
    element('span', 'static-world-kicker', 'WORLD RENDERER'),
    element('h1', null, 'Static map mode'),
    element(
      'p',
      null,
      'The GPU renderer is unavailable. OpenStreetMap, search, and context remain accessible.',
    ),
  );

  const iframe = element('iframe', 'static-world-map');
  iframe.src = staticFallbackMapUrl();
  iframe.title = 'Global OpenStreetMap view';
  iframe.loading = 'eager';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');

  const controls = element('aside', 'static-world-context');
  controls.appendChild(element('h2', null, 'Context'));
  controls.appendChild(element('p', 'static-world-reason', reason));
  controls.appendChild(element(
    'p',
    null,
    'Live Cesium event layers are unavailable in static mode; no event markers are synthesized.',
  ));

  const search = element('form', 'static-world-search');
  search.action = 'https://www.openstreetmap.org/search';
  search.method = 'get';
  search.target = '_blank';
  const input = element('input');
  input.name = 'query';
  input.type = 'search';
  input.placeholder = 'Search OpenStreetMap';
  input.setAttribute('aria-label', 'Search OpenStreetMap');
  const submit = element('button', null, 'SEARCH');
  submit.type = 'submit';
  search.append(input, submit);
  controls.appendChild(search);

  const profileLinks = element('nav', 'static-world-profile-links');
  profileLinks.setAttribute('aria-label', 'Retry renderer profile');
  for (const profile of ['minimal', 'mobile', 'balanced', 'high', 'ultra']) {
    profileLinks.appendChild(profileLink(profile));
  }
  controls.appendChild(profileLinks);

  const terminalLink = element('a', 'static-world-terminal-link', 'OPEN MOBIUS TERMINAL');
  try {
    const configuredTerminal = new URL(terminalUrl);
    terminalLink.href = ['http:', 'https:'].includes(configuredTerminal.protocol)
      ? configuredTerminal.href
      : 'https://terminal.mobius-substrate.com';
  } catch {
    terminalLink.href = 'https://terminal.mobius-substrate.com';
  }
  terminalLink.target = '_blank';
  terminalLink.rel = 'noreferrer';
  controls.appendChild(terminalLink);

  if (diagnostics) {
    const details = element('details', 'static-world-diagnostics');
    details.appendChild(element('summary', null, 'Renderer diagnostics'));
    const report = element('pre');
    report.textContent = JSON.stringify(diagnostics, null, 2);
    details.appendChild(report);
    controls.appendChild(details);
  }

  const attribution = element('p', 'static-world-attribution');
  const attributionLink = element('a', null, '© OpenStreetMap contributors');
  attributionLink.href = 'https://www.openstreetmap.org/copyright';
  attributionLink.target = '_blank';
  attributionLink.rel = 'noreferrer';
  attribution.appendChild(attributionLink);
  controls.appendChild(attribution);

  shell.append(header, iframe, controls);
  host.replaceChildren(shell);
  document.getElementById('loading-screen')?.classList.add('hidden');
  document.getElementById('renderer-compat-status')?.setAttribute('hidden', '');

  const state = Object.freeze({
    profile: 'fallback',
    reason: String(reason),
    diagnostics,
  });
  window.__godsEyeView = { rendererFallback: state };
  return state;
}
