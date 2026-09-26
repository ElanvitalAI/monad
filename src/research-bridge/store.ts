// PLAN §4.4 · Phase 1.4 — Research result store.
//
// Two layers of persistence:
//   1. In-memory ring (most recent N) — what `/research list` reads
//      and what the slash handler hands to the prefill formatter.
//   2. On-disk archive at `~/.elanous/research/<timestamp>-<topic>.md`
//      so a long research turn survives across sessions and the user
//      can grep prior queries from the filesystem.
//
// Both layers are bounded: the ring holds 20 entries (FIFO), and
// each archived file caps `output` at ~16 KiB to keep one runaway
// invocation from blowing up disk.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { debug } from '../debug/log.js';
import type { ExternalResearchResult } from './types.js';

const RING_LIMIT = 20;
const MAX_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_DIR = path.join(elanousStateRoot(), 'research');

let overrideDir: string | null = null;
const ring: ExternalResearchResult[] = [];

export function setResearchArchiveDir(dir: string | null): void {
  overrideDir = dir;
}

export function getResearchArchiveDir(): string {
  return overrideDir ?? DEFAULT_DIR;
}

function safeFilename(topic: string, startedAt: string): string {
  const stamp = startedAt.replace(/[:.]/g, '-');
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'research';
  return `${stamp}-${slug}.md`;
}

/** Add a result to the in-memory ring and write the archive file.
 *  Returns the absolute archive path so callers can surface it. */
export function recordResult(r: ExternalResearchResult): string | null {
  const ringEntry: ExternalResearchResult = { ...r };
  if (ringEntry.output.length > MAX_OUTPUT_BYTES) {
    ringEntry.output = ringEntry.output.slice(0, MAX_OUTPUT_BYTES) + '\n\n…(truncated)';
  }
  ring.push(ringEntry);
  while (ring.length > RING_LIMIT) ring.shift();

  let archivePath: string | null = null;
  try {
    fs.mkdirSync(getResearchArchiveDir(), { recursive: true });
    archivePath = path.join(getResearchArchiveDir(), safeFilename(r.topic, r.startedAt));
    const body = [
      `# ${r.topic}`,
      ``,
      `- skill: ${r.skill}`,
      `- started: ${r.startedAt}`,
      `- finished: ${r.finishedAt}`,
      `- duration: ${r.durationMs}ms`,
      `- ok: ${r.ok}`,
      ...(r.error ? [`- error: ${r.error}`] : []),
      ``,
      `## Output`,
      ``,
      ringEntry.output,
      ``,
    ].join('\n');
    fs.writeFileSync(archivePath, body, 'utf8');
    debug.log('research-bridge', 'archive', { path: archivePath, ok: r.ok });
  } catch (err) {
    debug.log('research-bridge', 'archive-fail', {
      error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
    archivePath = null;
  }
  return archivePath;
}

export function getRecentResults(n = RING_LIMIT): ExternalResearchResult[] {
  return ring.slice(-n).reverse();
}

export function clearResults(): void {
  ring.length = 0;
}
