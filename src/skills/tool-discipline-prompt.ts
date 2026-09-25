import {
  buildNativeToolPromptSummary,
  listNativeToolsForHost,
  type NativeToolCatalogEntry,
} from '../native-tool-catalog.js';

export interface DisciplinePromptOptions {
  /** Pre-filtered catalog from `src/tool-hints/gate.ts`. When absent,
   * the prompt uses the default skill surface. */
  catalog?: NativeToolCatalogEntry[];
  /** Hint-supplied reasons to surface to the LLM. */
  hintReasons?: string[];
  /** Active terminal sessions to render below the tool catalog. */
  terminalSessions?: Array<{
    id: string;
    title: string;
    state: 'foreground' | 'background' | 'exited';
    kind?: 'shell' | 'coding-agent';
    agentBrand?: string;
    attentionLevel: number;
    lastNotification?: string;
  }>;
}

export function buildSkillToolDisciplinePrompt(opts: DisciplinePromptOptions = {}): string {
  const source = opts.catalog ?? listNativeToolsForHost('skill');
  const cleanerTools = source
    .filter(tool => tool.cleanerFitThanShell)
    .map(tool => tool.displayName)
    .join('/');
  const parts = [
    `You have these tools: ${buildNativeToolPromptSummary('skill', source)}.`,
    'When the skill body documents shell commands (`npx tsx ...`, `python3 ...`, `node ...`), invoke them via Bash - DO NOT describe what they would do, ACTUALLY run them and feed the real output to the user.',
    cleanerTools ? `Use ${cleanerTools} when they are a cleaner fit than composing shell equivalents.` : '',
    'If a search is weak, inspect its results and search again using actual code identifiers or call-path terms.',
  ];
  if (opts.hintReasons && opts.hintReasons.length > 0) {
    parts.push(`Active hints: ${opts.hintReasons.join('; ')}.`);
  }
  const sessions = (opts.terminalSessions ?? []).filter(session => session.state !== 'exited');
  if (sessions.length > 0) {
    const lines = sessions.slice(0, 6).map(session => {
      const marker = session.state === 'foreground' ? 'fg' : 'bg';
      const brand = session.agentBrand ? `[${session.agentBrand}]` : session.kind ?? '';
      const attention = session.attentionLevel >= 2 ? ` attn:${session.attentionLevel}` : '';
      const notification = session.lastNotification ? ` — "${session.lastNotification.slice(0, 40)}"` : '';
      return `- ${session.id.slice(-8)} ${session.title} ${marker}${brand ? ` ${brand}` : ''}${attention}${notification}`;
    });
    const more = sessions.length > 6 ? ` (+${sessions.length - 6} more)` : '';
    parts.push(
      `ACTIVE TERMINAL SESSIONS:\n${lines.join('\n')}${more}\n` +
      'Use TerminalModalObserve({id}) on these before spawning a new shell.',
    );
  }
  return parts.filter(Boolean).join(' ');
}
