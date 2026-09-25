// Arc D — `mermaid-syntax` builtin verifier.
//
// Lightweight Mermaid syntax check — no external mermaid-cli (zero-dep
// constraint per AGENTS.md hot-path policy). Catches the two most
// common LLM mistakes:
//   1. Missing or unrecognised diagram-type keyword on the first
//      non-empty / non-comment line.
//   2. Bracket / brace / paren imbalance across the entire source
//      (e.g. `flowchart TD` followed by `A[label` without `]`).

import type { VerifierBuiltin, VerifierIssue, VerifierReport } from '../types.js';

const RECOGNISED_KINDS = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'quadrantChart',
  'sankey',
  'sankey-beta',
  'block-beta',
  'xychart-beta',
]);

export const mermaidSyntaxBuiltin: VerifierBuiltin = (
  _args,
  result,
  spec,
) => {
  if (spec.kind !== 'mermaid-syntax') {
    return { ok: true, issues: [] };
  }
  const field = spec.field ?? 'output';
  const raw = (result as Record<string, unknown>)[field];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      ok: false,
      issues: [{
        code: 'mermaid.empty',
        severity: 'warn',
        message: `result["${field}"] is not a non-empty string`,
        hint: 'Tool should produce mermaid source as a string.',
      }],
    };
  }

  const issues: VerifierIssue[] = [];

  // Strip the optional ```mermaid ... ``` fence so the kind detection
  // works on the raw diagram source.
  const stripped = stripFence(raw);
  const firstLine = firstSignificantLine(stripped);
  const kind = firstLine?.split(/\s+/, 1)[0] ?? '';
  if (!firstLine) {
    issues.push({
      code: 'mermaid.no-source',
      severity: 'warn',
      message: 'mermaid source is empty after stripping fences/comments',
      hint: 'Output a recognised diagram (flowchart, sequenceDiagram, etc.)',
    });
  } else if (!RECOGNISED_KINDS.has(kind)) {
    issues.push({
      code: 'mermaid.unknown-kind',
      severity: 'warn',
      message: `unrecognised diagram keyword "${kind}" on first line`,
      hint: `Start with one of: flowchart, graph, sequenceDiagram, classDiagram, stateDiagram, erDiagram, journey, gantt, pie, mindmap, timeline, gitGraph.`,
    });
  }

  const imbalance = bracketImbalance(stripped);
  for (const im of imbalance) {
    issues.push(im);
  }

  return mkReport(issues);
};

function stripFence(src: string): string {
  const fenceOpen = /^```(?:mermaid)?\s*\n/i;
  const fenceClose = /\n```\s*$/;
  let out = src.replace(fenceOpen, '');
  out = out.replace(fenceClose, '');
  return out;
}

function firstSignificantLine(src: string): string | null {
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('%%')) continue;   // mermaid comment
    return trimmed;
  }
  return null;
}

function bracketImbalance(src: string): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const pairs: Array<[string, string, string]> = [
    ['(', ')', 'paren'],
    ['[', ']', 'bracket'],
    ['{', '}', 'brace'],
  ];
  for (const [open, close, name] of pairs) {
    let depth = 0;
    for (const ch of src) {
      if (ch === open) depth++;
      else if (ch === close) depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      issues.push({
        code: `mermaid.unbalanced-${name}`,
        severity: 'warn',
        message: `${name}s are unbalanced (net ${depth > 0 ? '+' : ''}${depth})`,
        hint: depth > 0
          ? `${depth} unclosed ${name}(s) — add the matching ${close}.`
          : `${-depth} extra ${name}(s) — remove the unmatched ${close}.`,
      });
    }
  }
  return issues;
}

function mkReport(issues: VerifierIssue[]): VerifierReport {
  const consequential = issues.filter(i => i.severity !== 'info');
  return { ok: consequential.length === 0, issues };
}
