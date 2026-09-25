// ── PFC-S2 generalization: ACTIVE.md helper ──
//
// ACTIVE.md lives at <goalRoot>/ACTIVE.md and records:
//   - goalSlug + goalKind (the Conductor's routing decision)
//   - intake metadata (raw request + classifier provenance)
//   - classifiedAt + classifier + confidence + routedAdapter
//
// This is *per-goal persistent state* so that a session resuming on an
// existing goal can see how the goal was originally classified without
// re-running the classifier. Also doubles as a human-browsable record
// of what the conductor decided and why.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoalKind } from '../conductor/types.js';
import {
  parseFrontmatter,
  type ObsidianVault,
} from './obsidian-bridge.js';

export interface ActiveMdIntake {
  raw: string;
  channel?: string;
  requestedAt?: number;
  requester?: string;
}

export interface ActiveMdRecord {
  goalSlug: string;
  goalKind: GoalKind;
  intake: ActiveMdIntake;
  classifier: 'heuristic' | 'llm' | 'user-override' | 'fallback';
  confidence: number;
  classifiedAt: number;
  routedAdapter: string;
  pendingTracks?: readonly string[];
}

export function activeMdPath(goalRoot: string): string {
  return join(goalRoot, 'ACTIVE.md');
}

export function activeMdPathInVault(vault: ObsidianVault, goalRel: string): string {
  return join(vault.root, goalRel, 'ACTIVE.md');
}

// ── Render ─────────────────────────────────────────────────────────────

export function renderActiveMd(rec: ActiveMdRecord): string {
  const iso = (ms?: number) => (ms === undefined ? '' : new Date(ms).toISOString());

  const fm: string[] = [
    '---',
    `goalSlug: ${rec.goalSlug}`,
    `goalKind: ${rec.goalKind}`,
    'intake:',
    `  raw: ${JSON.stringify(rec.intake.raw)}`,
  ];
  if (rec.intake.channel) fm.push(`  channel: ${rec.intake.channel}`);
  if (rec.intake.requestedAt !== undefined) fm.push(`  requestedAt: ${iso(rec.intake.requestedAt)}`);
  if (rec.intake.requester) fm.push(`  requester: ${rec.intake.requester}`);
  fm.push(`classifier: ${rec.classifier}`);
  fm.push(`confidence: ${rec.confidence.toFixed(2)}`);
  fm.push(`classifiedAt: ${iso(rec.classifiedAt)}`);
  fm.push(`routedAdapter: ${rec.routedAdapter}`);
  if (rec.pendingTracks && rec.pendingTracks.length > 0) {
    fm.push(`pendingTracks: [${rec.pendingTracks.map((t) => JSON.stringify(t)).join(', ')}]`);
  }
  fm.push('---', '');

  const body = [
    `# ACTIVE — ${rec.goalSlug}`,
    '',
    `**Goal kind**: \`${rec.goalKind}\``,
    `**Routed to**: \`${rec.routedAdapter}\``,
    `**Classifier**: ${rec.classifier} (confidence ${rec.confidence.toFixed(2)})`,
    '',
    '## Intake',
    '',
    rec.intake.raw,
    '',
  ];

  return fm.join('\n') + body.join('\n');
}

// ── Write ──────────────────────────────────────────────────────────────

export function writeActiveMd(goalRoot: string, rec: ActiveMdRecord): string {
  const path = activeMdPath(goalRoot);
  const content = renderActiveMd(rec);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ── Read ───────────────────────────────────────────────────────────────

export function readActiveMd(goalRoot: string): ActiveMdRecord | null {
  const path = activeMdPath(goalRoot);
  if (!existsSync(path)) return null;
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); }
  catch { return null; }

  const { frontmatter } = parseFrontmatter(raw);
  const goalSlug = typeof frontmatter.goalSlug === 'string' ? frontmatter.goalSlug : null;
  const goalKind = typeof frontmatter.goalKind === 'string' ? frontmatter.goalKind : null;
  if (!goalSlug || !goalKind) return null;

  // Intake is nested; parseFrontmatter's shallow parser stores "intake"
  // as null + "raw:", "channel:" as peer keys if block-parsed. To keep
  // ACTIVE.md robust across parsers we store a separate `intakeRaw`
  // fallback and try both.
  let intakeRaw = '';
  const rawLine = raw.match(/^\s*raw:\s*(.*)$/m);
  if (rawLine) {
    const val = rawLine[1]!.trim();
    try { intakeRaw = JSON.parse(val); } catch { intakeRaw = val; }
  }

  const classifier = (typeof frontmatter.classifier === 'string'
    ? frontmatter.classifier
    : 'heuristic') as ActiveMdRecord['classifier'];
  const confidence = typeof frontmatter.confidence === 'number'
    ? frontmatter.confidence
    : Number(frontmatter.confidence ?? 0);
  const classifiedAt = typeof frontmatter.classifiedAt === 'string'
    ? Date.parse(frontmatter.classifiedAt)
    : Number(frontmatter.classifiedAt ?? Date.now());
  const routedAdapter = typeof frontmatter.routedAdapter === 'string'
    ? frontmatter.routedAdapter
    : 'unknown';
  const pendingTracks = Array.isArray(frontmatter.pendingTracks)
    ? (frontmatter.pendingTracks as readonly string[])
    : undefined;

  return {
    goalSlug,
    goalKind: goalKind as GoalKind,
    intake: { raw: intakeRaw },
    classifier,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    classifiedAt: Number.isFinite(classifiedAt) ? classifiedAt : Date.now(),
    routedAdapter,
    ...(pendingTracks ? { pendingTracks } : {}),
  };
}
