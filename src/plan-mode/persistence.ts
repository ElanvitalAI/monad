// Plan-mode artifact persistence — Phase WF3.
//
// Plan artifacts live under `~/.elanous/plans/<sessionId>.md`. Each
// artifact has YAML frontmatter (sessionId, title, created, updated,
// phase) + a freeform markdown body. We write the initial skeleton
// at EnterPlanMode and re-save on every Edit-against-the-plan-file
// (via apply.ts's existing file-write pipeline — the gate only
// allows the plan path).

import { promises as fsp } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { PlanArtifact, PlanPhase } from './types.js';

export function planDir(): string {
  const home = process.env.HOME || homedir();
  return join(home, '.elanous', 'plans');
}

export function planFilePathFor(sessionId: string): string {
  return join(planDir(), `${sessionId}.md`);
}

const SKELETON_BODY = `
# Plan

<!-- Phase 1 — Explore: describe what you learned from reading the code. -->

## Goal

_What the user is trying to achieve._

## Approach

_High-level strategy._

## Steps

1.
2.
3.

## Risks

- _(fill in as you review)_

## Test plan

- _(how you'll verify the change works)_
`.trim();

export interface PlanArtifactSeed {
  sessionId: string;
  title: string;
}

export async function initPlanArtifact(seed: PlanArtifactSeed): Promise<string> {
  await fsp.mkdir(planDir(), { recursive: true });
  const path = planFilePathFor(seed.sessionId);
  const now = Date.now();
  const frontmatter = renderFrontmatter({
    sessionId: seed.sessionId,
    title: seed.title,
    created: now,
    updated: now,
    phase: 'explore',
  });
  const body = `${frontmatter}\n\n${SKELETON_BODY}\n`;
  await fsp.writeFile(path, body, 'utf-8');
  return path;
}

export async function loadPlanArtifact(sessionId: string): Promise<PlanArtifact | null> {
  try {
    const text = await fsp.readFile(planFilePathFor(sessionId), 'utf-8');
    return parseArtifact(sessionId, text);
  } catch {
    return null;
  }
}

/** Read artifact by explicit path. Used by ExitPlanMode flow when the
 *  session knows its plan path but doesn't want to re-derive the id. */
export async function loadPlanArtifactFromPath(path: string): Promise<PlanArtifact | null> {
  try {
    const text = await fsp.readFile(path, 'utf-8');
    // Extract sessionId from filename ("<id>.md") — best effort.
    const base = path.split('/').pop() ?? '';
    const sessionId = base.replace(/\.md$/, '');
    return parseArtifact(sessionId, text);
  } catch {
    return null;
  }
}

// ── frontmatter helpers ─────────────────────────────────────────

interface FrontmatterFields {
  sessionId: string;
  title: string;
  created: number;
  updated: number;
  phase: PlanPhase;
}

function renderFrontmatter(f: FrontmatterFields): string {
  return [
    '---',
    `sessionId: ${yamlString(f.sessionId)}`,
    `title: ${yamlString(f.title)}`,
    `created: ${new Date(f.created).toISOString()}`,
    `updated: ${new Date(f.updated).toISOString()}`,
    `phase: ${f.phase}`,
    '---',
  ].join('\n');
}

function yamlString(s: string): string {
  // Simple quoting — escape quotes + backslashes, wrap in double.
  return JSON.stringify(s);
}

function parseArtifact(sessionId: string, text: string): PlanArtifact {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    return {
      sessionId, title: '(untitled)',
      created: Date.now(), updated: Date.now(),
      phase: 'explore', body: text,
    };
  }
  const fm = m[1]!;
  const body = m[2]!.replace(/^\n+/, '');
  const title = extractField(fm, 'title') ?? '(untitled)';
  const phaseRaw = extractField(fm, 'phase') ?? 'explore';
  const phase: PlanPhase = (['inactive', 'explore', 'design', 'review', 'finalize'].includes(phaseRaw)
    ? phaseRaw as PlanPhase
    : 'explore');
  const created = parseTs(extractField(fm, 'created')) ?? Date.now();
  const updated = parseTs(extractField(fm, 'updated')) ?? Date.now();
  return { sessionId, title, created, updated, phase, body };
}

function extractField(frontmatter: string, key: string): string | null {
  for (const line of frontmatter.split('\n')) {
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (match) {
      const raw = match[1]!.trim();
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function parseTs(s: string | null): number | null {
  if (!s) return null;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : null;
}
