import { DASHBOARD_SETUP_INLINE_TARGETS, type DashboardSetupInlineTarget } from '../setup-inline.js';

export const DASHBOARD_SETUP_STEPS = [
  'llm',
  'skills',
  'obsidian',
  'telegram',
  'discord',
] as const;

export type DashboardSetupStep = typeof DASHBOARD_SETUP_STEPS[number];

export const DASHBOARD_SETUP_STEP_DESCRIPTIONS: Record<DashboardSetupStep, string> = {
  llm: 'LLM provider · 모델 선택 + API key',
  skills: 'Skill directory · agent skill 위치',
  obsidian: 'Obsidian vault path',
  telegram: 'Telegram bot · token + 허용 user',
  discord: 'Discord bot · token + 허용 user',
};

export type DashboardChatMainSetupCommand =
  | { kind: 'inline'; target?: DashboardSetupInlineTarget }
  | { kind: 'launch'; step?: DashboardSetupStep }
  | { kind: 'reset' }
  | { kind: 'help' }
  | { kind: 'unknown'; subcommand: string };

export function resolveDashboardChatMainSetupCommand(
  args: string[],
): DashboardChatMainSetupCommand {
  const sub = (args[0] || '').toLowerCase();
  if (sub === '') return { kind: 'inline' };
  if (sub === 'reset') return { kind: 'reset' };
  if (sub === 'help' || sub === '?') return { kind: 'help' };
  if ((DASHBOARD_SETUP_INLINE_TARGETS as readonly string[]).includes(sub)) {
    return { kind: 'inline', target: sub as DashboardSetupInlineTarget };
  }
  if ((DASHBOARD_SETUP_STEPS as readonly string[]).includes(sub)) {
    return { kind: 'launch', step: sub as DashboardSetupStep };
  }
  return { kind: 'unknown', subcommand: sub };
}

export function dashboardSetupHelpLines(): string[] {
  return [
    '❯ /setup — setup entry',
    '  기본 진입은 monad picker/modal 자산을 쓰는 inline flow.',
    '  legacy wizard step 은 기존 popup terminal fallback 유지.',
    '',
    '  · `/setup`                 inline category picker (env auto-detect)',
    '  · `/setup provider`        inline provider picker — 7 providers',
    '  · `/setup discord`         inline discord setup',
    '  · `/setup <legacy-step>`   기존 wizard step — popup',
    '  · `/setup reset`           marker reset → 재부팅 시 자동',
    '  · `/setup help`            본 안내',
    '',
    '  ⚡ env auto-detect:',
    '    XAI_API_KEY / GROK_API_KEY     → grok',
    '    OPENAI_API_KEY                  → openai (also openai-codex apikey)',
    '    ANTHROPIC_API_KEY               → anthropic',
    '    GEMINI_API_KEY / GOOGLE_API_KEY → gemini',
    '    LOCAL_LLM_URL                   → local (Ollama / LM Studio)',
    '    "Detect all" 항목으로 한번에 rotation 등록.',
    '',
    '  legacy step:',
    ...DASHBOARD_SETUP_STEPS.map(
      (step) => `    /setup ${step.padEnd(13)} ${DASHBOARD_SETUP_STEP_DESCRIPTIONS[step]}`,
    ),
    '',
    '  popup terminal 은 legacy step 에서만 열립니다.',
  ];
}
