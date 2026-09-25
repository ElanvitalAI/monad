/**
 * `MorningDigestComposer` — Phase 2 D7 / RESEARCH §10.
 *
 * Roll up an overnight dispatch window into a single user-facing
 * summary. The composer is pure — it takes a window of run records +
 * a few summary inputs and returns a `MorningDigest` shape that the
 * PWA splash, push notification, and Discord/Telegram surfaces render.
 *
 * Surfaces decided per E3 (사용자 선택 default PWA). This module only
 * owns the digest *shape*; surface adapters live next door.
 */

// ──────────────────── Inputs ──────────────────────────────────────────

export type RunOutcome = 'completed' | 'failed' | 'awaiting-approval' | 'cancelled' | 'retrying';

export interface DigestRun {
  taskId: string;
  taskTitle: string;
  outcome: RunOutcome;
  startedAt: number;
  endedAt?: number;
  /** Set when outcome === 'failed' or 'retrying'. */
  errorSummary?: string;
  /** When the run dispatched to a local model. */
  modelId?: string;
  /** Tokens used (input + output combined for display). */
  tokensUsed?: number;
  /** Cost in USD (zero for local). */
  costUsd?: number;
}

export interface DigestResourceSnapshot {
  localLlmSeconds?: number;
  apiCostUsd?: number;
  tokenTotal?: number;
}

export interface DigestPlanItem {
  taskTitle: string;
  expectedSlot?: string;
}

export interface MorningDigestInput {
  /** ISO date string for the digest header. */
  date: string;
  /** Sleep window covered (UTC ISO). */
  windowStart: string;
  windowEnd: string;
  runs: readonly DigestRun[];
  upcoming?: readonly DigestPlanItem[];
  resources?: DigestResourceSnapshot;
}

// ──────────────────── Outputs ─────────────────────────────────────────

export interface MorningDigestSections {
  summary: string;
  completed: string[];
  reviewNeeded: string[];
  retrying: string[];
  failed: string[];
  upcoming: string[];
  resourceSummary: string | null;
}

export interface MorningDigest {
  date: string;
  windowStart: string;
  windowEnd: string;
  counts: {
    completed: number;
    failed: number;
    awaitingApproval: number;
    retrying: number;
    cancelled: number;
    total: number;
  };
  sections: MorningDigestSections;
  /** Plaintext rendering — used by Discord/Telegram + push body. */
  plainText: string;
  /** Markdown rendering — used by PWA splash + email digest. */
  markdown: string;
}

// ──────────────────── Helpers ─────────────────────────────────────────

function fmtMinutes(totalMs: number): string {
  const m = Math.round(totalMs / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${rem}m`;
}

function totalRuntime(runs: readonly DigestRun[]): number {
  let total = 0;
  for (const r of runs) {
    if (r.endedAt === undefined || r.startedAt === undefined) continue;
    if (r.outcome !== 'completed') continue;
    total += Math.max(0, r.endedAt - r.startedAt);
  }
  return total;
}

function bullet(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

// ──────────────────── Composer ────────────────────────────────────────

export function composeMorningDigest(input: MorningDigestInput): MorningDigest {
  const runs = input.runs;

  const counts = {
    completed: 0,
    failed: 0,
    awaitingApproval: 0,
    retrying: 0,
    cancelled: 0,
    total: runs.length,
  };
  for (const r of runs) {
    if (r.outcome === 'completed') counts.completed += 1;
    else if (r.outcome === 'failed') counts.failed += 1;
    else if (r.outcome === 'awaiting-approval') counts.awaitingApproval += 1;
    else if (r.outcome === 'retrying') counts.retrying += 1;
    else if (r.outcome === 'cancelled') counts.cancelled += 1;
  }

  const totalMs = totalRuntime(runs);
  const summary =
    counts.completed > 0
      ? `${counts.completed} task${counts.completed === 1 ? '' : 's'} completed · ${fmtMinutes(totalMs)} of total run time`
      : `0 tasks completed overnight`;

  const completed = runs
    .filter((r) => r.outcome === 'completed')
    .map((r) => r.taskTitle);
  const reviewNeeded = runs
    .filter((r) => r.outcome === 'awaiting-approval')
    .map((r) => r.taskTitle);
  const retrying = runs
    .filter((r) => r.outcome === 'retrying')
    .map((r) => `${r.taskTitle}${r.errorSummary ? ` (${r.errorSummary})` : ''}`);
  const failed = runs
    .filter((r) => r.outcome === 'failed')
    .map((r) => `${r.taskTitle}${r.errorSummary ? ` (${r.errorSummary})` : ''}`);
  const upcoming = (input.upcoming ?? []).map((p) =>
    p.expectedSlot ? `${p.taskTitle} (slot: ${p.expectedSlot})` : p.taskTitle,
  );

  const resourceSummary = input.resources ? renderResources(input.resources) : null;

  const sections: MorningDigestSections = {
    summary,
    completed,
    reviewNeeded,
    retrying,
    failed,
    upcoming,
    resourceSummary,
  };

  return {
    date: input.date,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    counts,
    sections,
    plainText: renderPlain(sections),
    markdown: renderMarkdown(input, sections),
  };
}

function renderResources(r: DigestResourceSnapshot): string {
  const parts: string[] = [];
  if (r.localLlmSeconds !== undefined) parts.push(`local LLM ${fmtMinutes(r.localLlmSeconds * 1000)}`);
  if (r.apiCostUsd !== undefined) parts.push(`API $${r.apiCostUsd.toFixed(2)}`);
  if (r.tokenTotal !== undefined) parts.push(`${r.tokenTotal.toLocaleString()} tokens`);
  return parts.length > 0 ? parts.join(' · ') : '';
}

function renderPlain(s: MorningDigestSections): string {
  const lines: string[] = [`Good morning · ${s.summary}`];
  if (s.completed.length > 0) {
    lines.push('');
    lines.push(`Completed:`);
    lines.push(bullet(s.completed));
  }
  if (s.reviewNeeded.length > 0) {
    lines.push('');
    lines.push(`Awaiting your review:`);
    lines.push(bullet(s.reviewNeeded));
  }
  if (s.retrying.length > 0) {
    lines.push('');
    lines.push(`Retrying:`);
    lines.push(bullet(s.retrying));
  }
  if (s.failed.length > 0) {
    lines.push('');
    lines.push(`Failed:`);
    lines.push(bullet(s.failed));
  }
  if (s.upcoming.length > 0) {
    lines.push('');
    lines.push(`Today's plan:`);
    lines.push(bullet(s.upcoming));
  }
  if (s.resourceSummary) {
    lines.push('');
    lines.push(`Resources: ${s.resourceSummary}`);
  }
  return lines.join('\n');
}

function renderMarkdown(input: MorningDigestInput, s: MorningDigestSections): string {
  const lines: string[] = [
    `# Good morning · ${input.date}`,
    '',
    `_Window:_ ${input.windowStart} → ${input.windowEnd}`,
    '',
    `**${s.summary}**`,
  ];
  if (s.completed.length > 0) {
    lines.push('', `## ✅ Completed (${s.completed.length})`, bullet(s.completed));
  }
  if (s.reviewNeeded.length > 0) {
    lines.push('', `## 🔍 Awaiting review (${s.reviewNeeded.length})`, bullet(s.reviewNeeded));
  }
  if (s.retrying.length > 0) {
    lines.push('', `## 🔁 Retrying (${s.retrying.length})`, bullet(s.retrying));
  }
  if (s.failed.length > 0) {
    lines.push('', `## ❌ Failed (${s.failed.length})`, bullet(s.failed));
  }
  if (s.upcoming.length > 0) {
    lines.push('', `## 📅 Today's plan`, bullet(s.upcoming));
  }
  if (s.resourceSummary) {
    lines.push('', `## 📊 Resources`, s.resourceSummary);
  }
  return lines.join('\n');
}
