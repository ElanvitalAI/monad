// PFC-S3.15 / W9 Y5 · Hansei — blame-free retrospective.
// Cf. ROADMAP-prefrontal-cortex.md · ROADMAP-background-reasoning §6 Y5.

import type { RetrospectiveCard, RetrospectiveAction } from './retrospective-card.js';

export interface HanseiInput {
  title: string;
  /** What happened (factual, no blame). */
  what: string;
  /** Outcome vs. expectation. */
  why?: string;
  /** Lessons (1+ entries · blame-free wording enforced). */
  lessons: string[];
  /** Concrete countermeasures with owner. */
  countermeasures: RetrospectiveAction[];
  /** Who participated (used for fairness scan only — not displayed). */
  participants?: string[];
  /** Run id / mission id / etc. */
  refId: string;
  source: RetrospectiveCard['source'];
  /** Free-form metric (cycle time, failure demand, ...). */
  metrics?: Record<string, number>;
  createdAt: number;
}

export interface HanseiReport {
  card: RetrospectiveCard;
  markdown: string;
  frontmatter: Record<string, unknown>;
  notices: string[];
}

/** Words that surface blame; flagged for the author to rewrite. */
const BLAME_TOKENS = [
  'fault', 'blame', 'idiot', 'stupid', 'lazy', 'incompetent',
  '잘못', '책임', '바보', '게으른', '실력없',
];

function blameScan(text: string): string[] {
  const lower = text.toLowerCase();
  return BLAME_TOKENS.filter((t) => lower.includes(t.toLowerCase()));
}

function section(title: string, body: string | undefined): string {
  const content = body?.trim();
  return content ? `## ${title}\n\n${content}\n` : `## ${title}\n\n_TBD_\n`;
}

function listSection(title: string, items: readonly string[]): string {
  if (items.length === 0) return `## ${title}\n\n_none_\n`;
  return `## ${title}\n\n${items.map((s) => `- ${s}`).join('\n')}\n`;
}

function countermeasureSection(items: readonly RetrospectiveAction[]): string {
  if (items.length === 0) return `## Countermeasures\n\n_none_\n`;
  const rows = items.map((a) => {
    const due = a.due ? ` · due ${a.due}` : '';
    return `- **${a.owner}** — ${a.action}${due}`;
  });
  return `## Countermeasures\n\n${rows.join('\n')}\n`;
}

export function renderHansei(input: HanseiInput): HanseiReport {
  if (!input.title?.trim()) throw new Error('renderHansei: title required');
  if (!input.what?.trim()) throw new Error('renderHansei: what required');
  if (!Array.isArray(input.lessons) || input.lessons.length === 0) {
    throw new Error('renderHansei: at least one lesson required');
  }
  if (!Array.isArray(input.countermeasures) || input.countermeasures.length === 0) {
    throw new Error('renderHansei: at least one countermeasure required');
  }

  const notices: string[] = [];
  const blameHits = new Set<string>();
  for (const text of [input.what, input.why ?? '', ...input.lessons]) {
    for (const hit of blameScan(text)) blameHits.add(hit);
  }
  if (blameHits.size > 0) {
    notices.push(`blame-language flagged: ${Array.from(blameHits).join(', ')}`);
  }

  const md = [
    section('What happened', input.what),
    section('Why (gap vs. expectation)', input.why),
    listSection('Lessons', input.lessons),
    countermeasureSection(input.countermeasures),
    input.metrics && Object.keys(input.metrics).length > 0
      ? listSection('Metrics', Object.entries(input.metrics).map(([k, v]) => `${k}: ${v}`))
      : '',
  ].filter(Boolean).join('\n');

  const card: RetrospectiveCard = {
    kind: 'retrospective',
    refId: input.refId,
    source: input.source,
    outcome: blameHits.size > 0 ? 'partial' : 'mixed',
    summary: input.what.slice(0, 256),
    lessons: input.lessons,
    improvements: input.countermeasures.map((c) => c.action),
    actions: input.countermeasures,
    ...(input.metrics ? { metrics: input.metrics } : {}),
    createdAt: input.createdAt,
  };

  const frontmatter: Record<string, unknown> = {
    kind: 'retrospective',
    title: input.title,
    refId: input.refId,
    source: input.source,
    createdAt: input.createdAt,
    lessons_count: input.lessons.length,
    countermeasures_count: input.countermeasures.length,
    blame_flagged: blameHits.size > 0,
  };
  if (input.metrics) frontmatter.metrics = input.metrics;

  return {
    card,
    markdown: `# Hansei — ${input.title}\n\n${md}`,
    frontmatter,
    notices,
  };
}

export interface HanseiWriter {
  /** Persist the markdown + frontmatter into the vault and the card
   *  into KGS. Best-effort — writer errors propagate so caller logs. */
  write(report: HanseiReport): Promise<void>;
}
