// T1 (tools) + A0 (optional finance domain pack) — telegram agent.
//
// Guards: (1) the finance analyst prompt keeps its load-bearing rules
// (pull real data, read-only, NEVER trade); (2) the finance pack is
// OPTIONAL — financeEnabled gates it off by default so a non-investment
// deployment gets a plain agent; (3) config parses/serializes finance.enabled;
// (4) nexus wires the tool-enabled runTurn with cfg. Per feedback_source_
// level_grep_test_value + feedback_dep_inject_seam_must_be_wired.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FINANCE_ANALYST_PROMPT,
  FINANCE_RESOURCE_MAP_BASENAME,
  loadFinanceResourceMap,
  financeAgentSystemPrompt,
  financeEnabled,
  marketClock,
} from '../src/domains/finance.js';
import { wireNexusTelegramQaPollers } from '../src/nexus/index.js';
import { makeTelegramAgentRunTurn } from '../src/telegram-agent.js';
import type { NexusTelegramTriggerBotOpts } from '../src/nexus/api/telegram-trigger-bot.js';
import type { TelegramBot } from '../src/telegram.js';
import type { WorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon.js';
import { buildUserConfig, saveUserConfig, type UserConfig } from '../src/user-config.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fin-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('finance analyst prompt', () => {
  test('instructs to pull real data (not from memory) + economical', () => {
    expect(FINANCE_ANALYST_PROMPT).toMatch(/do not answer from memory/i);
    expect(FINANCE_ANALYST_PROMPT).toMatch(/pull real data/i);
    expect(FINANCE_ANALYST_PROMPT).toMatch(/economical|few tool calls|do NOT explore/i);
  });
  test('hard-guards trades + read-only + no machine paths', () => {
    // HARD RULE (mandate 정합화 2026-07-07): ad-hoc 매매 금지 + mandate-게이트 예외.
    expect(FINANCE_ANALYST_PROMPT).toMatch(/ad-hoc\/one-off trades|do NOT bypass the mandate gates/i);
    expect(FINANCE_ANALYST_PROMPT).toMatch(/mandate-gated cycle/i);          // 예외 카브아웃 명시
    expect(FINANCE_ANALYST_PROMPT).toMatch(/read[- ]only/i);
    expect(FINANCE_ANALYST_PROMPT).not.toMatch(/\/Users\/|\/home\/|\.claude\/skills/);
  });
});

describe('finance resource map (per-deployment, optional)', () => {
  test('loads when present, empty otherwise; folds into the prompt', () => {
    expect(loadFinanceResourceMap(dir)).toBe('');
    writeFileSync(join(dir, FINANCE_RESOURCE_MAP_BASENAME), '## DB\nx_asset.db\n');
    expect(loadFinanceResourceMap(dir)).toContain('x_asset.db');
    expect(financeAgentSystemPrompt()).toContain(FINANCE_ANALYST_PROMPT.slice(0, 40));
  });
});

function cfgWith(finance: Partial<UserConfig['finance']>): UserConfig {
  return { finance: { enabled: false, ...finance } } as unknown as UserConfig;
}

describe('A0 — finance pack is optional', () => {
  test('financeEnabled reflects config, default off', () => {
    expect(financeEnabled(cfgWith({}))).toBe(false);
    expect(financeEnabled(cfgWith({ enabled: true }))).toBe(true);
  });
  test('makeTelegramAgentRunTurn builds regardless of finance flag', () => {
    // finance off = plain tool agent (no analyst persona); on = analyst.
    expect(typeof makeTelegramAgentRunTurn(cfgWith({ enabled: false }))).toBe('function');
    expect(typeof makeTelegramAgentRunTurn(cfgWith({ enabled: true }))).toBe('function');
  });
});

describe('config parse/serialize · finance.enabled', () => {
  function writeCfg(finance: Record<string, unknown>): string {
    const p = join(dir, 'config.json');
    writeFileSync(p, JSON.stringify({ finance }), 'utf-8');
    return p;
  }
  test('defaults to false when absent', () => {
    expect(buildUserConfig(join(dir, 'nope.json')).finance.enabled).toBe(false);
  });
  test('parses enabled:true and round-trips through save', () => {
    const cfg = buildUserConfig(writeCfg({ enabled: true }));
    expect(cfg.finance.enabled).toBe(true);
    const out = join(dir, 'out.json');
    saveUserConfig(cfg, out);
    expect(JSON.parse(readFileSync(out, 'utf-8')).finance.enabled).toBe(true);
  });
});

describe('marketClock — active time/session awareness', () => {
  test('US regular open, KR closed (Mon 14:00 ET = Tue 03:00 KST)', () => {
    const s = marketClock(new Date('2026-07-06T18:00:00Z')); // 14:00 EDT Mon / 03:00 KST Tue
    expect(s).toMatch(/US OPEN/);
    expect(s).toMatch(/KR CLOSED/);
    expect(s).toContain('KST');
    expect(s).toContain('ET');
  });
  test('weekend = all closed', () => {
    const s = marketClock(new Date('2026-07-05T04:00:00Z')); // Sun
    expect(s).toMatch(/KR CLOSED/);
    expect(s).toMatch(/US CLOSED/);
  });
});

describe('nexus wire', () => {
  test('passes a cfg-scoped tool-enabled runTurnImpl into the telegram bot', () => {
    const baseToken = '123:base-token';
    const channelToken = '456:channel-token';
    const cfg = {
      telegram: {
        enabled: true,
        botToken: baseToken,
        allowedUsers: [123],
        channels: [
          { name: 'qa', botToken: channelToken, chatId: 123, interactive: true, roles: ['qa'] },
        ],
      },
      finance: { enabled: true },
    } as unknown as UserConfig;
    const workflowDaemon: Pick<WorkflowRuntimeDaemon, 'dispatchTelegram'> = {
      dispatchTelegram: async () => [],
    };
    const forwardedBotOptions: NexusTelegramTriggerBotOpts[] = [];
    const runTurnByConfig = new WeakMap<UserConfig, ReturnType<typeof makeTelegramAgentRunTurn>>();

    const handles = wireNexusTelegramQaPollers(cfg, workflowDaemon, {
      makeTelegramAgentRunTurn: (scopedCfg) => {
        const runTurnImpl = makeTelegramAgentRunTurn(scopedCfg);
        runTurnByConfig.set(scopedCfg, runTurnImpl);
        return runTurnImpl;
      },
      resolveTelegramChannels: (telegramConfig) => telegramConfig.channels ?? [],
      interactivePollerTokens: (channels) => channels,
      createTriggerBot: (opts) => {
        forwardedBotOptions.push(opts);
        return {
          bot: {} as unknown as TelegramBot,
          stop: async () => undefined,
        };
      },
    });

    expect(handles).toHaveLength(1);
    expect(forwardedBotOptions).toHaveLength(1);
    const forwarded = forwardedBotOptions[0]!;
    expect(forwarded.token).toBe(channelToken);
    expect(forwarded.userConfig).not.toBe(cfg);
    expect(forwarded.userConfig?.telegram.botToken).toBe(channelToken);
    expect(forwarded.userConfig?.finance).toBe(cfg.finance);
    expect(forwarded.runTurnImpl).toBe(runTurnByConfig.get(forwarded.userConfig as UserConfig));
    expect(forwarded.runTurnImpl).toBeFunction();
  });
});
