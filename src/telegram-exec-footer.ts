// Compact execution footer for a telegram reply — surfaces which engine
// handled the turn (self = monad's native tool loop, vs an ACP delegate) and
// the model. So "어떤 모델로 · self인지 acp-codex/acp-claude인지" is visible per
// reply. Standalone (no deps) so both the brain (telegram-agent) and the slash
// path (telegram-commands) can import it without an import cycle.

function acpLabel(backend: string): string {
  const b = backend.toLowerCase();
  if (b.startsWith('claude')) return 'acp-claude';
  if (b.startsWith('codex') || b.startsWith('cas') || b === 'cx') return 'acp-codex';
  if (b.startsWith('gemini') || b === 'gem') return 'acp-gemini';
  if (b.startsWith('grok')) return 'acp-grok';
  return `acp-${b}`;
}

export function executionFooter(opts: { delegatedBackend?: string; model?: string; effort?: string; source?: string }): string {
  // `<engine> · <model>(<effort>)` — both are meaningful indices (무슨 모델로 ·
  // 얼마나 깊게 추론). effort rides in parens to stay compact. Backends that
  // don't report a model (claude-code-acp) show head-only rather than guess.
  const head = opts.delegatedBackend ? `🤖 ${acpLabel(opts.delegatedBackend)}` : '🧠 monad';
  const model = opts.model || (opts.delegatedBackend ? '' : '(default)');
  if (!model) return `— ${head}`;
  const modelTok = opts.effort ? `${model}(${opts.effort})` : model;
  return `— ${head} · ${modelTok}${opts.source ? ` · ${opts.source}` : ''}`;
}

/** Compact TRUE-execution badge (no leading `— `, no source) for space-
 *  tight inline surfaces like the TUI completion line
 *  (`✔ Streaming (19s · ↓ 200 tokens · 🧠 terra(high))`). Same truth as
 *  `executionFooter` — self shows `🧠 <model>(<effort>)`, a delegate shows
 *  `🤖 acp-<backend>` — but trimmed to one token so it rides inside the
 *  thinking-line parenthetical. Shares `acpLabel` so both stay in sync. */
export function executionBadge(opts: { delegatedBackend?: string; model?: string; effort?: string }): string {
  if (opts.delegatedBackend) return `🤖 ${acpLabel(opts.delegatedBackend)}`;
  if (!opts.model) return '🧠 monad';
  return `🧠 ${opts.effort ? `${opts.model}(${opts.effort})` : opts.model}`;
}

/** A short arg hint for a mid-turn tool-progress line (self streaming) —
 *  the command / file / query the tool is acting on, truncated. Empty when
 *  no recognizable arg. */
export function selfToolArgHint(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  const v = a.command ?? a.file_path ?? a.path ?? a.query ?? a.pattern;
  if (typeof v !== 'string' || !v.trim()) return '';
  const s = v.trim().replace(/\s+/g, ' ');
  return ` · ${s.length > 60 ? s.slice(0, 60) + '…' : s}`;
}
