const HOME_VIEWERS = new WeakSet();

export function setCameraHomeActive(viewer, active) {
  if (!viewer || (typeof viewer !== 'object' && typeof viewer !== 'function')) return false;
  if (active) HOME_VIEWERS.add(viewer);
  else HOME_VIEWERS.delete(viewer);
  return active === true;
}

export function isCameraHomeActive(viewer) {
  return Boolean(viewer && HOME_VIEWERS.has(viewer));
}
