import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerSetupCommand } from './setup-cli.js';
import type { UserConfig } from '../user-config.js';

const MONAD_AUTH = JSON.stringify({ version: 1, providers: { 'openai-codex': { tokens: { accessToken: 'access', refreshToken: 'refresh' } } } });
const CODEX_AUTH = JSON.stringify({ tokens: { access_token: 'access', refresh_token: 'refresh' } });
const config = (provider?: string) => ({ llm: { provider } }) as UserConfig;

type SetupState = { monad?: boolean; provider?: string; codex?: boolean; externalReady?: boolean; monadAuth?: string; codexAuth?: string; answer?: string; nonInteractive?: boolean; stdinTty?: boolean; runtimeProvider?: string };

async function runSetup(state: SetupState = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  const writes: UserConfig[] = [];
  const prompts: string[] = [];
  let doctorCalls = 0;
  let currentProvider = state.provider;
  const files = new Map<string, string>();
  if (state.monad) files.set('/home/fake/.monad/auth.json', state.monadAuth ?? MONAD_AUTH);
  if (state.codex) files.set('/home/fake/.codex/auth.json', state.codexAuth ?? CODEX_AUTH);
  const program = new Command();
  registerSetupCommand(program, {
    homeDir: () => '/home/fake',
    exists: (path) => files.has(path),
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`missing fake file: ${path}`);
      return value;
    },
    getUserConfig: () => config(currentProvider),
    saveUserConfig: (next) => { writes.push(next); currentProvider = next.llm.provider; },
    runDoctor: () => {
      doctorCalls += 1;
      return {
        ok: true,
        credentials: [],
        externalCommands: [{ name: 'codex', tier: 'required', status: state.externalReady === false ? 'missing' : 'found', breaks: 'Codex app-server integration' }],
      };
    },
    prompt: async (message) => { prompts.push(message); return state.answer; },
    isStdinTty: () => state.stdinTty === true,
    out: { log: (line) => output.push(line), error: (line) => errors.push(line) },
    setExitCode: (code) => exitCodes.push(code),
    resolveRuntimeProvider: () => state.runtimeProvider,
  });
  await program.parseAsync(['node', 'monad', 'setup', ...(state.nonInteractive === false ? [] : ['--non-interactive'])]);
  return { text: output.join('\n'), output, errors, exitCodes, writes, prompts, doctorCalls };
}

function section(text: string, heading: string, nextHeading?: string): string {
  const start = text.indexOf(heading);
  const end = nextHeading === undefined ? text.length : text.indexOf(nextHeading, start);
  return text.slice(start, end < 0 ? text.length : end);
}

describe('setup CLI', () => {
  test('non-interactive calls doctor, shows its detailed command report and all guidance, never prompts or writes, and succeeds', async () => {
    const result = await runSetup({ externalReady: false });
    expect(result.doctorCalls).toBe(1);
    expect(result.exitCodes).toEqual([0]);
    expect(result.prompts).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.text).toContain('codex: missing (required)');
    expect(result.text).toContain('Breaks: Codex app-server integration');
    expect(result.text).toContain('`monad login openai-codex`');
    expect(result.text).toContain('`monad config set llm.provider openai-codex`');
    expect(result.text).toContain('`codex login`');
    expect(result.text).toContain('No LLM provider available');
    expect(result.text).toContain('codex app-server stdin drain timeout');
    expect(result.text).toContain('Would ask: Set llm.provider to openai-codex now? [y/N]');
  });

  test('has no child-process or Bun.spawn execution boundary for browser-login commands', () => {
    const source = readFileSync(fileURLToPath(new URL('./setup-cli.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/node:child_process|\bspawn\s*\(/);
    expect(source).not.toContain('Bun.spawn');
  });

  test('reports all eight independent credential combinations with exactly their missing steps', async () => {
    for (const [monad, provider, codex] of [
      [false, false, false], [false, false, true], [false, true, false], [false, true, true],
      [true, false, false], [true, false, true], [true, true, false], [true, true, true],
    ] as const) {
      const result = await runSetup({ monad, provider: provider ? 'openai-codex' : undefined, codex });
      const expectedMissing = [
        !monad && 'monad OpenAI Codex login',
        !provider && 'LLM provider configuration',
        !codex && 'Codex CLI login',
      ].filter(Boolean);
      for (const name of expectedMissing) expect(result.text).toContain(`missing: ${name}`);
      expect((result.text.match(/^missing:/gm) ?? []).length).toBe(expectedMissing.length);
    }
  });

  test('rejects empty, malformed, and wrong-provider auth files as incomplete', async () => {
    for (const state of [
      { monad: true, codex: true, monadAuth: '', codexAuth: CODEX_AUTH },
      { monad: true, codex: true, monadAuth: '{', codexAuth: CODEX_AUTH },
      { monad: true, codex: true, monadAuth: JSON.stringify({ providers: { anthropic: { tokens: { accessToken: 'a', refreshToken: 'r' } } } }), codexAuth: CODEX_AUTH },
      { monad: true, codex: true, monadAuth: MONAD_AUTH, codexAuth: '{}' },
      { monad: true, codex: true, monadAuth: MONAD_AUTH, codexAuth: '{' },
      { monad: true, codex: true, monadAuth: MONAD_AUTH, codexAuth: JSON.stringify({ tokens: { access_token: 'a' } }) },
    ]) {
      const result = await runSetup({ ...state, provider: 'openai-codex' });
      expect(result.text).toMatch(/missing: (monad OpenAI Codex login|Codex CLI login)/);
    }
  });

  test('writes provider exactly once only after consent and recomputes the final capabilities after the write', async () => {
    const accepted = await runSetup({ monad: true, codex: true, answer: 'y', nonInteractive: false, stdinTty: true });
    const declined = await runSetup({ monad: true, codex: true, answer: 'n', nonInteractive: false, stdinTty: true });
    expect(accepted.prompts).toHaveLength(1);
    expect(accepted.writes).toHaveLength(1);
    expect(accepted.writes[0]!.llm.provider).toBe('openai-codex');
    expect(section(accepted.text, 'Available now:', 'Unavailable until')).toContain('- OpenAI Codex-backed monad sessions');
    expect(declined.writes).toEqual([]);
    expect(declined.text).toContain('Not changed. To complete LLM provider configuration');
  });

  test('places each named capability in exactly one list and includes required external commands in app-server readiness', async () => {
    const ready = await runSetup({ monad: true, provider: 'openai-codex', codex: true });
    const missingCommands = await runSetup({ monad: true, provider: 'openai-codex', codex: true, externalReady: false });
    const readyAvailable = section(ready.text, 'Available now:', 'Unavailable until');
    const readyUnavailable = section(ready.text, 'Unavailable until');
    const missingAvailable = section(missingCommands.text, 'Available now:', 'Unavailable until');
    const missingUnavailable = section(missingCommands.text, 'Unavailable until');
    expect(readyAvailable).toContain('- Codex app-server integration');
    expect(readyUnavailable).not.toContain('Codex app-server integration');
    expect(missingAvailable).not.toContain('Codex app-server integration');
    expect(missingUnavailable).toContain('- Codex app-server integration');
    expect(missingAvailable).not.toContain('External command-dependent integrations');
    expect(missingUnavailable).toContain('- External command-dependent integrations');
  });

  test('refuses a non-TTY stdin before asking, with a non-zero exit and the existing onboarding sentence plus the named non-interactive path', async () => {
    const result = await runSetup({ nonInteractive: false, stdinTty: false });
    expect(result.prompts).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.output).toEqual([]);
    expect(result.exitCodes).toEqual([1]);
    expect(result.errors).toEqual(['대화형 온보딩은 stdin TTY가 있는 자리에서만 실행할 수 있다. 무인 설정은 `monad setup --non-interactive`를 사용하라.']);
    expect(result.errors.join('\\n')).not.toContain('at ');
  });

  // ⛔ 2026-09-23 — provider 단계는 «런타임 최종 결정»으로 잰다(Phase 3 의 거짓 손 ③).
  test('provider=auto 가 런타임에서 openai-codex 로 풀리면 «완료» — 설정하라고 하지 않고, 묻지도 않는다', async () => {
    const r = await runSetup({ monad: true, codex: true, provider: 'auto', runtimeProvider: 'auto:openai-codex' });
    expect(r.text).toContain('completed: LLM provider configuration');
    expect(r.text).not.toContain('`monad config set llm.provider openai-codex`');
    expect(r.text).not.toContain('Would ask');
    expect(section(r.text, 'Available now:', 'Unavailable until setup is complete:')).toContain('OpenAI Codex-backed monad sessions');
  });

  test('대조군 — provider=auto 가 다른 provider(grok)로 풀리면 여전히 «미완»이다', async () => {
    const r = await runSetup({ monad: true, codex: true, provider: 'auto', runtimeProvider: 'auto:grok' });
    expect(r.text).toContain('missing: LLM provider configuration');
  });
});
