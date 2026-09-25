// H5 Phase 2 · Channel router.
//
// Classify PTY output chunks into logical channels: reasoning,
// tool-call, plan, message, or raw. Classification is heuristic —
// regex patterns for common cases plus per-adapter hooks that win
// over patterns when the adapter knows its binary's format better
// (codex emits distinct prefixes, claude has its own markers).
//
// PLAN-h5-embodied-agent-bus-phase-2.md §4.2.

export type ChannelName = 'reasoning' | 'tool-call' | 'plan' | 'message' | 'raw';

export interface ChannelMatch {
  readonly channel: ChannelName;
  readonly confidence: number;        // 0.0 - 1.0
  readonly matchedBy: string;         // e.g. 'codex-reasoning-prefix'
}

export interface ChannelContext {
  readonly adapterId: string;
}

export type AdapterHook = (chunk: string, ctx: ChannelContext) => ChannelMatch | null;

export interface RegisteredPattern {
  readonly channel: ChannelName;
  readonly regex: RegExp;
  readonly priority: number;
  readonly label: string;
}

export class ChannelRouter {
  private patterns: RegisteredPattern[] = [];
  private readonly hooksByAdapter = new Map<string, AdapterHook[]>();
  private seq = 0;

  /** Classify a chunk. Adapter hooks (highest first by registration
   *  order) win over regex patterns (priority then registration).
   *  Unmatched chunks fall through to `raw` at confidence 0.0. */
  classify(chunk: string, ctx: ChannelContext): ChannelMatch {
    const hooks = this.hooksByAdapter.get(ctx.adapterId) ?? [];
    for (const hook of hooks) {
      try {
        const m = hook(chunk, ctx);
        if (m) return m;
      } catch {
        // Adapter hook bugs degrade to regex · never crash classify.
      }
    }
    for (const p of this.patterns) {
      if (p.regex.test(chunk)) {
        return {
          channel: p.channel,
          confidence: 0.6 + Math.min(0.3, p.priority / 10),
          matchedBy: p.label,
        };
      }
    }
    return { channel: 'raw', confidence: 0.0, matchedBy: 'default' };
  }

  registerPattern(pattern: Omit<RegisteredPattern, 'priority' | 'label'> & {
    priority?: number;
    label?: string;
  }): () => void {
    const entry: RegisteredPattern = {
      channel: pattern.channel,
      regex: pattern.regex,
      priority: pattern.priority ?? 0,
      label: pattern.label ?? `pattern-${this.seq++}`,
    };
    this.patterns.push(entry);
    this.patterns.sort((a, b) => b.priority - a.priority);
    return () => {
      const idx = this.patterns.indexOf(entry);
      if (idx >= 0) this.patterns.splice(idx, 1);
    };
  }

  registerAdapterHook(adapterId: string, hook: AdapterHook): () => void {
    let list = this.hooksByAdapter.get(adapterId);
    if (!list) {
      list = [];
      this.hooksByAdapter.set(adapterId, list);
    }
    list.push(hook);
    return () => {
      const idx = list!.indexOf(hook);
      if (idx >= 0) list!.splice(idx, 1);
      if (list!.length === 0) this.hooksByAdapter.delete(adapterId);
    };
  }

  /** Reset to empty. Test isolation. */
  clear(): void {
    this.patterns = [];
    this.hooksByAdapter.clear();
    this.seq = 0;
  }

  /** Read-only view of registered patterns for inspection. */
  listPatterns(): readonly RegisteredPattern[] {
    return this.patterns;
  }
}

// ─── Built-in patterns · shared across adapters ──────────────────

/** Register the default set of coarse patterns. Callers may skip
 *  this and register only their own. */
export function registerDefaultPatterns(router: ChannelRouter): () => void {
  const disposers: Array<() => void> = [];
  disposers.push(
    router.registerPattern({
      channel: 'reasoning',
      regex: /\b(thinking|reasoning|thought):/i,
      priority: 2,
      label: 'builtin-reasoning-prefix',
    }),
  );
  disposers.push(
    router.registerPattern({
      channel: 'tool-call',
      regex: /\b(tool|exec|running|executing):/i,
      priority: 2,
      label: 'builtin-tool-prefix',
    }),
  );
  disposers.push(
    router.registerPattern({
      channel: 'plan',
      regex: /\b(plan|steps|todo):/i,
      priority: 1,
      label: 'builtin-plan-prefix',
    }),
  );
  disposers.push(
    router.registerPattern({
      channel: 'message',
      regex: /\S/,  // any non-whitespace content defaults to message
      priority: 0,
      label: 'builtin-nonempty-message',
    }),
  );
  return () => disposers.forEach((d) => d());
}

// ─── Codex-specific adapter hook ─────────────────────────────────

/** Recognises codex's JSONL event lines (`--experimental-json`
 *  output · kind field) and maps them to channels. Also handles
 *  the classic `[reasoning]` / `[tool]` prefix forms. */
export function codexChannelHook(): AdapterHook {
  return (chunk, _ctx) => {
    const trimmed = chunk.trimStart();
    // JSON-line events from `codex exec --experimental-json`
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { kind?: string };
        const kind = parsed.kind;
        if (kind === 'reasoning') {
          return { channel: 'reasoning', confidence: 0.95, matchedBy: 'codex-json-reasoning' };
        }
        if (kind === 'command_execution' || kind === 'tool_call') {
          return { channel: 'tool-call', confidence: 0.95, matchedBy: 'codex-json-tool' };
        }
        if (kind === 'todo_list' || kind === 'plan') {
          return { channel: 'plan', confidence: 0.9, matchedBy: 'codex-json-plan' };
        }
        if (kind === 'agent_message') {
          return { channel: 'message', confidence: 0.9, matchedBy: 'codex-json-message' };
        }
      } catch {
        /* not valid JSON · fall through */
      }
    }
    // Bracket-prefix style
    if (/^\[reasoning\]/.test(trimmed)) {
      return { channel: 'reasoning', confidence: 0.85, matchedBy: 'codex-bracket-reasoning' };
    }
    if (/^\[tool\]|^\[exec\]/.test(trimmed)) {
      return { channel: 'tool-call', confidence: 0.85, matchedBy: 'codex-bracket-tool' };
    }
    return null;
  };
}

// ─── Claude Code-specific adapter hook ───────────────────────────
//
// Claude Code CLI interactive output uses a distinctive bullet-+-indent
// convention for tool calls and results. With `--output-format
// stream-json` it also emits typed JSON events. This hook covers both.

export function claudeChannelHook(): AdapterHook {
  return (chunk, _ctx) => {
    const trimmed = chunk.trimStart();
    // JSON-stream events (`--output-format stream-json`): each line is a
    // typed envelope like `{"type":"assistant","message":{...}}`.
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as {
          type?: string;
          subtype?: string;
          message?: { role?: string };
        };
        const type = parsed.type;
        const subtype = parsed.subtype;
        if (type === 'thinking' || subtype === 'thinking') {
          return { channel: 'reasoning', confidence: 0.95, matchedBy: 'claude-json-thinking' };
        }
        if (type === 'tool_use' || subtype === 'tool_use' || type === 'tool_result') {
          return { channel: 'tool-call', confidence: 0.95, matchedBy: 'claude-json-tool' };
        }
        if (type === 'assistant' || parsed.message?.role === 'assistant') {
          return { channel: 'message', confidence: 0.9, matchedBy: 'claude-json-assistant' };
        }
        if (type === 'user' || parsed.message?.role === 'user') {
          return { channel: 'message', confidence: 0.7, matchedBy: 'claude-json-user' };
        }
      } catch {
        /* fall through */
      }
    }
    // Interactive bullet markers: `● Read(...)`, `● Bash(...)`, etc.
    // · these appear on tool invocations.
    if (/^●\s/.test(trimmed)) {
      return { channel: 'tool-call', confidence: 0.85, matchedBy: 'claude-bullet-tool' };
    }
    // Continuation markers: `⎿` prefixes tool results.
    if (/^⎿\s/.test(trimmed)) {
      return { channel: 'tool-call', confidence: 0.8, matchedBy: 'claude-cont-tool' };
    }
    // Plan/todo block headers used in some Claude Code output modes.
    if (/^\s*(Plan|Todo|Tasks?):/i.test(trimmed) && /\n\s*[-*]\s/.test(chunk)) {
      return { channel: 'plan', confidence: 0.8, matchedBy: 'claude-plan-block' };
    }
    return null;
  };
}

// ─── Gemini CLI-specific adapter hook ────────────────────────────
//
// Gemini CLI has two output surfaces: the plain interactive REPL
// (free-text output with occasional `Thinking...` / `Running:` prefixes)
// and `--output-format json` / `--experimental-acp` streams. This hook
// handles the common cases conservatively; uncertain lines return null
// so the default patterns can take over.

export function geminiChannelHook(): AdapterHook {
  return (chunk, _ctx) => {
    const trimmed = chunk.trimStart();
    // JSON-stream envelopes (`--output-format json` / ACP mode)
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as {
          type?: string;
          kind?: string;
          role?: string;
        };
        const type = parsed.type ?? parsed.kind;
        if (type === 'thinking' || type === 'thought' || type === 'reasoning') {
          return { channel: 'reasoning', confidence: 0.95, matchedBy: 'gemini-json-thinking' };
        }
        if (type === 'tool_call' || type === 'function_call' || type === 'tool_use' || type === 'tool_result') {
          return { channel: 'tool-call', confidence: 0.95, matchedBy: 'gemini-json-tool' };
        }
        if (type === 'plan' || type === 'task_list') {
          return { channel: 'plan', confidence: 0.9, matchedBy: 'gemini-json-plan' };
        }
        if (type === 'response' || type === 'content' || parsed.role === 'model' || parsed.role === 'assistant') {
          return { channel: 'message', confidence: 0.85, matchedBy: 'gemini-json-response' };
        }
      } catch {
        /* fall through */
      }
    }
    // Prefixes seen in Gemini CLI plain output.
    if (/^(Thinking|Thought)[\s.:]/i.test(trimmed)) {
      return { channel: 'reasoning', confidence: 0.8, matchedBy: 'gemini-prefix-thinking' };
    }
    if (/^(Running|Executing|Calling\s+tool)[\s:.]/i.test(trimmed)) {
      return { channel: 'tool-call', confidence: 0.8, matchedBy: 'gemini-prefix-tool' };
    }
    return null;
  };
}

/** Process-wide default router · convenient for non-test callers. */
export const defaultChannelRouter = new ChannelRouter();
