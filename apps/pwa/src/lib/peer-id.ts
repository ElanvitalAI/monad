// WT-M-1 — opaque short peer id, generated once per browser tab and
// persisted in sessionStorage so navigations within the tab keep the
// same id. Used by `terminal/input` to tag the originating peer so
// other devices' `terminalInputActivity` indicators can filter
// self-echo.
//
// Length = 8 base36 chars (~41 bits entropy) — enough to avoid
// collisions among the user's typical fleet (~6 nodes per memory) by
// a wide margin without bloating the wire frame.

const STORAGE_KEY = 'monad.pwa.peerId';

function generate(): string {
  // Avoid Math.random — sessionStorage carries it across reloads so a
  // single high-quality call at boot is fine. Crypto when available;
  // fallback satisfies older WebViews.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return ((BigInt(buf[0]!) << 32n) | BigInt(buf[1]!)).toString(36).slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

let cached: string | null = null;

export function getPeerId(): string {
  if (cached) return cached;
  if (typeof window === 'undefined') {
    cached = generate();
    return cached;
  }
  let id = window.sessionStorage.getItem(STORAGE_KEY);
  if (!id || id.length === 0) {
    id = generate();
    window.sessionStorage.setItem(STORAGE_KEY, id);
  }
  cached = id;
  return id;
}
