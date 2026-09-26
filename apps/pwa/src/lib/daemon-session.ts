/**
 * sessionId management — localStorage default + URL ?session= override.
 * Mirrors PR #1555 sticky REPL semantics: stable per browser, with explicit
 * fork (:fork meta-command) producing a fresh id.
 */

const STORAGE_KEY = 'elanous.daemon.sessionId';

export function generateSessionId(): string {
  // crypto.randomUUID exists in modern browsers + Node 20+.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random (only used in non-modern envs).
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  // URL override wins (e.g. ?session=abc-123 in href).
  const fromUrl = new URLSearchParams(window.location.search).get('session');
  if (fromUrl) {
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(STORAGE_KEY);
}

export function ensureSessionId(): string {
  const existing = loadSessionId();
  if (existing) return existing;
  const fresh = generateSessionId();
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, fresh);
  }
  return fresh;
}

export function forkSession(): string {
  const fresh = generateSessionId();
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, fresh);
  }
  return fresh;
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
