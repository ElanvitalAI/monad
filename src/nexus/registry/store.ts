// NEXUS · binding store (Phase N-3.5 PR τ)
//
// File-backed per-channel store. Each channel = one JSON file at
// `~/.monad/nexus/bindings/<channel>.json` (0o600). Channel files are
// created lazily on first write; missing files = empty channel.
//
// Concurrency: file writes are not protected by a lock — single-writer
// rule (D8) applies (NEXUS process is the only mutator). External tools
// can read freely.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BINDING_FILE_VERSION,
  BindingStoreError,
  SAFE_CHANNEL_RE,
  validateChannel,
  validateKey,
  type Binding,
  type BindingChannel,
  type ChannelSummary,
} from './types.js';
import { nexusBindingsDir } from '../paths.js';
import { debug } from '../../debug/log.js';

function emptyChannel(channel: string): BindingChannel {
  return { version: BINDING_FILE_VERSION, channel, bindings: {} };
}

function readChannelFile(channel: string): BindingChannel {
  const path = nexusBindingsDir(channel);
  if (!existsSync(path)) return emptyChannel(channel);
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BindingChannel>;
    if (parsed.version !== BINDING_FILE_VERSION) return emptyChannel(channel);
    return {
      version: BINDING_FILE_VERSION,
      channel,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      bindings: (parsed.bindings ?? {}) as Record<string, Binding>,
    };
  } catch {
    return emptyChannel(channel);
  }
}

function writeChannelFile(ch: BindingChannel): void {
  const path = nexusBindingsDir(ch.channel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ch, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SetBindingOpts {
  sessionId?: string;
  label?: string;
  meta?: Record<string, unknown>;
  /** When true, merge `meta` into the existing binding's meta instead
   *  of replacing. Default false (replace). */
  mergeMeta?: boolean;
}

export interface SetBindingResult {
  binding: Binding;
  outcome: 'created' | 'updated';
}

export function setBinding(channel: string, key: string, opts: SetBindingOpts): SetBindingResult {
  const chErr = validateChannel(channel);
  if (chErr) throw new BindingStoreError(channel, null, chErr);
  const keyErr = validateKey(key);
  if (keyErr) throw new BindingStoreError(channel, key, keyErr);

  const ch = readChannelFile(channel);
  const existing = ch.bindings[key];
  const merged: Binding = {
    key,
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : (existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {})),
    ...(opts.label !== undefined ? { label: opts.label } : (existing?.label !== undefined ? { label: existing.label } : {})),
    ...(opts.meta !== undefined
      ? { meta: opts.mergeMeta && existing?.meta ? { ...existing.meta, ...opts.meta } : opts.meta }
      : (existing?.meta !== undefined ? { meta: existing.meta } : {})),
    updatedAt: new Date().toISOString(),
  };
  ch.bindings[key] = merged;
  writeChannelFile(ch);
  if (debug.enabled) {
    debug.log('nexus.registry.binding.set', `${channel}/${key}`, {
      outcome: existing ? 'updated' : 'created',
      hasSessionId: merged.sessionId !== undefined,
    });
  }
  return { binding: merged, outcome: existing ? 'updated' : 'created' };
}

export function getBinding(channel: string, key: string): Binding | undefined {
  if (validateChannel(channel) || validateKey(key)) return undefined;
  return readChannelFile(channel).bindings[key];
}

export function deleteBinding(channel: string, key: string): boolean {
  if (validateChannel(channel) || validateKey(key)) return false;
  const ch = readChannelFile(channel);
  if (!(key in ch.bindings)) return false;
  delete ch.bindings[key];
  writeChannelFile(ch);
  if (debug.enabled) {
    debug.log('nexus.registry.binding.delete', `${channel}/${key}`, {});
  }
  return true;
}

export function listBindings(channel: string): Binding[] {
  if (validateChannel(channel)) return [];
  return Object.values(readChannelFile(channel).bindings);
}

/** Set the channel-level description (for /v1/registry/bindings list). */
export function setChannelDescription(channel: string, description: string): void {
  const chErr = validateChannel(channel);
  if (chErr) throw new BindingStoreError(channel, null, chErr);
  const ch = readChannelFile(channel);
  ch.description = description;
  writeChannelFile(ch);
}

/** Drop the channel file entirely (no-op when missing). Useful for
 *  test cleanup and admin commands. */
export function deleteChannel(channel: string): boolean {
  if (validateChannel(channel)) return false;
  const path = nexusBindingsDir(channel);
  if (!existsSync(path)) return false;
  try { unlinkSync(path); return true; } catch { return false; }
}

/** Lists every channel file present in the bindings dir. Skips files
 *  whose name doesn't match SAFE_CHANNEL_RE (defense-in-depth against
 *  manual file drops). */
export function listChannels(): ChannelSummary[] {
  const dir = nexusBindingsDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const summaries: ChannelSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const channel = entry.slice(0, -'.json'.length);
    if (!SAFE_CHANNEL_RE.test(channel)) continue;
    try {
      const path = nexusBindingsDir(channel);
      if (!statSync(path).isFile()) continue;
      const ch = readChannelFile(channel);
      summaries.push({
        channel,
        ...(ch.description ? { description: ch.description } : {}),
        bindingCount: Object.keys(ch.bindings).length,
      });
    } catch { /* skip bad files */ }
  }
  summaries.sort((a, b) => a.channel.localeCompare(b.channel));
  return summaries;
}
