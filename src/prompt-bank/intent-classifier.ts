// ── Intent classifier (AU7) ──
//
// Scans user text for intent signals that should bias the LLM toward
// calling AskUserQuestion. Conservative by design: classification
// produces intent TAGS, not forced behaviour — the prompt-bank
// fragments with matching `triggers.intent` are then selected and
// injected into the turn. If no fragment exists for an intent, the
// classifier is a no-op.
//
// Intents shipped by AU7:
//
//   • 'ambiguous'    — vague directives like "refactor", "clean up",
//                      "improve", "optimize" without a subject.
//   • 'destructive'  — delete/drop/wipe/rm/reset verbs in the
//                      user's own language (the LLM might otherwise
//                      proceed without a second look).
//   • 'multi-file'   — "everywhere", "across the codebase", "all
//                      the files" — user asking for something that
//                      spans files without naming them.
//
// Kept as regex + noun-verb heuristics because LLM-based intent
// classification at the user-input stage would add a round-trip
// per turn. Good enough for triggering extra prompt context; the
// LLM still judges whether to actually call AskUserQuestion.

export type IntentTag = 'ambiguous' | 'destructive' | 'multi-file';

interface IntentRule {
  tag: IntentTag;
  re: RegExp;
  /** Short note for debug logs. */
  label: string;
}

const RULES: IntentRule[] = [
  // Ambiguous verbs — solo or with vague object.
  { tag: 'ambiguous', re: /\b(refactor|clean\s*up|improve|optimi[sz]e|tidy|rework)\b/i, label: 'vague-verb' },
  { tag: 'ambiguous', re: /\b(fix|update|adjust)\s+(this|it|these|everything|the\s+code)\b/i, label: 'vague-object' },
  // Korean — JS \b is ASCII-only so drop it. CJK chars never
  // accidentally run into adjacent word-char English, and anchor-
  // free matching is fine for intent flagging.
  { tag: 'ambiguous', re: /(그거|이거|저거|코드|전체)\s*(좀|을|를|도)?\s*(고쳐|정리|리팩터|개선)/, label: 'vague-ko' },

  // Destructive verbs — user's own intent, the LLM must not assume
  // the scope.
  { tag: 'destructive', re: /\b(delete|drop|wipe|erase|remove|purge|nuke|clean\s*up|clear\s+out)\b/i, label: 'destructive-verb' },
  { tag: 'destructive', re: /\brm\s+-[rf]+\b/i, label: 'rm-rf-in-prompt' },
  { tag: 'destructive', re: /\bforce\s*(?:-|\s)?push\b/i, label: 'force-push' },
  { tag: 'destructive', re: /\breset\s+--?hard\b/i, label: 'hard-reset' },
  { tag: 'destructive', re: /\b(drop|truncate)\s+(?:table|database|schema|index)\b/i, label: 'sql-drop' },
  { tag: 'destructive', re: /(삭제|제거|지워|날려|초기화)/, label: 'destructive-ko' },

  // Multi-file / codebase-wide.
  { tag: 'multi-file', re: /\b(everywhere|across\s+(?:the\s+)?(?:codebase|project)|all\s+the\s+files?|every\s+(?:file|module))\b/i, label: 'wide-scope-en' },
  { tag: 'multi-file', re: /\b(every\s+\w+\s+file|all\s+\w+\s+files)\b/i, label: 'every-x-file' },
  { tag: 'multi-file', re: /(모든|전체|전부|모조리)\s*(파일|폴더|모듈|코드)/, label: 'wide-scope-ko' },
];

/** Classify the user's current text. Returns a deduped list of
 *  detected intent tags. Empty when no pattern matched. */
export function classifyUserIntents(text: string): IntentTag[] {
  if (!text || typeof text !== 'string') return [];
  const hits = new Set<IntentTag>();
  for (const rule of RULES) {
    if (rule.re.test(text)) hits.add(rule.tag);
  }
  return [...hits];
}

/** Test-only: inspect what matched + why, for debugging prompt
 *  misfires. Not part of the public path. */
export function classifyUserIntentsDetailed(text: string): Array<{ tag: IntentTag; label: string }> {
  if (!text) return [];
  const hits: Array<{ tag: IntentTag; label: string }> = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) hits.push({ tag: rule.tag, label: rule.label });
  }
  return hits;
}
