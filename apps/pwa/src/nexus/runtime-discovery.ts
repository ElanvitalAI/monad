// PWA · Nexus runtime discovery (Phase N-4 PR ν)
//
// Reads `~/.monad/nexus/runtime.json` to find the nexus HTTP URL. Server
// component / route handler usage only — the file system is unavailable
// from the browser. The discovered URL is then injected into client
// components via a context provider (see hooks/use-nexus-state.ts).
//
// Override: `MONAD_NEXUS_URL` env wins (production deployments where
// nexus runs on a known address can skip the discovery step).

import type { NexusRuntimeMeta } from './types';

export interface DiscoveredNexus {
  url: string;
  source: 'env' | 'runtime-file' | 'fallback';
  runtime?: NexusRuntimeMeta;
}

const DEFAULT_FALLBACK_URL = 'http://127.0.0.1:31415';

export function discoverNexusUrl(opts: {
  envSource?: Record<string, string | undefined>;
  readRuntimeFile?: () => NexusRuntimeMeta | null;
  fallbackUrl?: string;
} = {}): DiscoveredNexus {
  const env = opts.envSource ?? (process.env as Record<string, string | undefined>);
  const explicit = env.MONAD_NEXUS_URL?.trim();
  if (explicit) {
    return { url: explicit.replace(/\/$/, ''), source: 'env' };
  }

  const runtime = (opts.readRuntimeFile ?? defaultReadRuntimeFile)();
  if (runtime?.httpPort) {
    const host = runtime.httpHost ?? '127.0.0.1';
    return {
      url: `http://${host}:${runtime.httpPort}`,
      source: 'runtime-file',
      runtime,
    };
  }

  return { url: opts.fallbackUrl ?? DEFAULT_FALLBACK_URL, source: 'fallback' };
}

function defaultReadRuntimeFile(): NexusRuntimeMeta | null {
  // Lazy require so this module stays browser-safe (the actual fs access
  // only runs from server components / route handlers).
  try {
    const path = nexusRuntimePath();
    const fs = require('node:fs') as typeof import('node:fs');
    if (!fs.existsSync(path)) return null;
    return JSON.parse(fs.readFileSync(path, 'utf-8')) as NexusRuntimeMeta;
  } catch {
    return null;
  }
}

function nexusRuntimePath(): string {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const override = process.env.MONAD_NEXUS_DIR?.trim();
  const root = override && override.length > 0
    ? override
    : path.join(os.homedir(), '.monad', 'nexus');
  return path.join(root, 'runtime.json');
}
