// ── PFC-S3.7: A3 Report (Toyota 1-page) ──
//
// A3 is Toyota's standard problem-solving report format, so named
// because it fits on a single A3-size sheet. The canonical 9-box
// layout bundles: Background / Current State / Goal / Root Cause
// Analysis / Countermeasures / Implementation Plan / Follow-up.
// Assembling as markdown is deterministic; this module renders +
// validates + (optionally) persists via KnowledgeWrite.

export interface A3Input {
  title: string;                             // doc title
  problem: string;                           // 1-sentence problem statement
  background?: string;                       // context: how we got here
  current?: string;                          // what's happening now (data/metrics)
  goal?: string;                             // target state + success metric
  analysis?: string;                         // RCA summary — often includes 5-Why / Fishbone
  countermeasures: readonly string[];        // proposed actions (min 1)
  plan?: string;                             // who / when / how
  followup?: string;                         // verification + escalation
  owner: string;                             // responsible party
  /** Optional — if supplied + vault available, persist as a KnowledgeWrite
   *  kind='a3' artifact. Relative path under vault root. */
  rel_path?: string;
}

export interface A3Report {
  title: string;
  owner: string;
  markdown: string;            // full rendered body
  frontmatter: Record<string, unknown>;  // YAML-ready
  placeholderCount: number;    // how many _TBD_ sections
  notices?: string[];
}

const PLACEHOLDER = '_TBD_';

function section(header: string, body: string | undefined): { text: string; placeholder: boolean } {
  const content = body?.trim();
  if (!content) {
    return { text: `## ${header}\n\n${PLACEHOLDER}\n`, placeholder: true };
  }
  return { text: `## ${header}\n\n${content}\n`, placeholder: false };
}

/** Render the 9-box A3 as markdown + frontmatter. Missing sections are
 *  filled with `_TBD_` (never silent) and counted. */
export function renderA3(input: A3Input): A3Report {
  if (!input.title?.trim()) throw new Error('renderA3: title is required');
  if (!input.problem?.trim()) throw new Error('renderA3: problem is required');
  if (!input.owner?.trim()) throw new Error('renderA3: owner is required');
  if (!Array.isArray(input.countermeasures) || input.countermeasures.length === 0) {
    throw new Error('renderA3: at least one countermeasure is required');
  }

  const cleaned = input.countermeasures.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0) {
    throw new Error('renderA3: countermeasures cannot all be empty');
  }

  const parts: string[] = [];
  let placeholderCount = 0;

  // Problem is mandatory
  parts.push(`# ${input.title}\n`);
  parts.push(`## Problem\n\n${input.problem.trim()}\n`);

  const bg = section('Background', input.background);
  parts.push(bg.text);
  if (bg.placeholder) placeholderCount++;

  const cur = section('Current State', input.current);
  parts.push(cur.text);
  if (cur.placeholder) placeholderCount++;

  const goal = section('Goal', input.goal);
  parts.push(goal.text);
  if (goal.placeholder) placeholderCount++;

  const analysis = section('Root Cause Analysis', input.analysis);
  parts.push(analysis.text);
  if (analysis.placeholder) placeholderCount++;

  // Countermeasures as bullet list
  parts.push('## Countermeasures\n');
  cleaned.forEach((c) => parts.push(`- ${c}`));
  parts.push('');

  const plan = section('Implementation Plan', input.plan);
  parts.push(plan.text);
  if (plan.placeholder) placeholderCount++;

  const followup = section('Follow-up', input.followup);
  parts.push(followup.text);
  if (followup.placeholder) placeholderCount++;

  parts.push(`---\n\n_Owner: ${input.owner.trim()}_\n`);

  const frontmatter: Record<string, unknown> = {
    kind: 'a3',
    problem: input.problem.trim(),
    countermeasure: cleaned.join('; '),
    owner: input.owner.trim(),
    title: input.title.trim(),
  };

  const notices: string[] = [];
  if (placeholderCount >= 3) {
    notices.push(
      `${placeholderCount} sections unfilled (_TBD_) — A3 의 힘은 빈 칸 없이 작성하는 규율에 있음.`,
    );
  }

  return {
    title: input.title.trim(),
    owner: input.owner.trim(),
    markdown: parts.join('\n'),
    frontmatter,
    placeholderCount,
    ...(notices.length > 0 ? { notices } : {}),
  };
}
