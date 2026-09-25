// ── Wave 1 · /context slash command ──────────────────────────────────
//
// Single user-facing slash that prints the current LLM context state.
// Sits over the telemetry ring buffer + format module. The actual
// chat surface registers this via `buildContextSlashCommand()` and
// hooks the returned descriptor into its slash registry.

import { formatContextSummary, type FormatContextOpts } from './format.js';

export interface ContextSlashCommandDescriptor {
  name: string;
  aliases: string[];
  description: string;
  /** Render the formatted summary text. The host decides where to
   *  print it (chat log line, modal, status bar). */
  render(opts?: FormatContextOpts): string;
}

export function buildContextSlashCommand(): ContextSlashCommandDescriptor {
  return {
    name: 'context',
    aliases: ['ctx'],
    description:
      'Show current LLM context — latest call tokens · ctx window % · session aggregate · cache hit rate',
    render(opts?: FormatContextOpts): string {
      const summary = formatContextSummary(opts ?? {});
      return summary.lines.join('\n');
    },
  };
}
