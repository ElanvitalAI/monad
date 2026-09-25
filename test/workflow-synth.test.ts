// Scheduler-retirement R3 (2026-05-11) — workflow synth core tests.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { synthWorkflowFromIntent } from '../src/workflow-synth';

function makeLlmStub(responses: string[]): (args: { prompt: string; systemPrompt?: string; signal?: AbortSignal }) => Promise<string> {
  let i = 0;
  return async () => {
    if (i >= responses.length) throw new Error('LLM stub exhausted');
    return responses[i++];
  };
}

const VALID_CRON_YAML = `name: daily-tweets
description: Pull tweets and save to obsidian.
nodes:
  - id: trigger
    scheduleTrigger:
      type: cron
      cron: '0 9 * * *'
  - id: fetch
    skill: omni-crawl
    arguments: "trending tweets"
    depends_on: [trigger]
`;

describe('synthWorkflowFromIntent', () => {
  test('preview=true returns YAML without saving', async () => {
    const r = await synthWorkflowFromIntent(
      { intent: 'pull tweets daily 9am', preview: true },
      { callLLM: makeLlmStub([VALID_CRON_YAML]) },
    );
    expect(r.ok).toBe(true);
    expect(r.registered).toBe(false);
    expect(r.workflowName).toBe('daily-tweets');
    expect(r.triggerSummary).toBe('cron: 0 9 * * *');
    expect(r.yaml).toContain('scheduleTrigger');
  });

  test('preview=false saves to scope=project (tmp cwd)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wf-synth-'));
    const r = await synthWorkflowFromIntent(
      { intent: 'pull tweets daily 9am', preview: false, scope: 'project', cwd },
      { callLLM: makeLlmStub([VALID_CRON_YAML]) },
    );
    expect(r.ok).toBe(true);
    expect(r.registered).toBe(true);
    expect(r.registeredPath).toContain('daily-tweets.yaml');
    expect(readFileSync(r.registeredPath!, 'utf8')).toContain('scheduleTrigger');
  });

  test('strips ```yaml ... ``` fences from LLM output', async () => {
    const fenced = '```yaml\n' + VALID_CRON_YAML + '```';
    const r = await synthWorkflowFromIntent(
      { intent: 'x', preview: true },
      { callLLM: makeLlmStub([fenced]) },
    );
    expect(r.ok).toBe(true);
    expect(r.yaml).not.toContain('```');
  });

  test('self-repair on first-pass validation failure', async () => {
    const broken = 'name: bad\nnodes:\n  - id: a\n    bash: ""\n';
    const r = await synthWorkflowFromIntent(
      { intent: 'pull tweets', preview: true },
      { callLLM: makeLlmStub([broken, VALID_CRON_YAML]) },
    );
    expect(r.ok).toBe(true);
    expect(r.repaired).toBe(true);
    expect(r.workflowName).toBe('daily-tweets');
  });

  test('fails after two failed attempts', async () => {
    const broken1 = 'name: bad1\n';
    const broken2 = 'name: bad2\n';
    const r = await synthWorkflowFromIntent(
      { intent: 'x', preview: true },
      { callLLM: makeLlmStub([broken1, broken2]) },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('validation failed');
  });

  test('LLM throw → returns error result', async () => {
    const r = await synthWorkflowFromIntent(
      { intent: 'x', preview: true },
      { callLLM: async () => { throw new Error('rate limit'); } },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('rate limit');
  });

  test('describes webhook trigger', async () => {
    const yaml = `name: hook-handler
description: Handle inbound webhook.
nodes:
  - id: trigger
    webhookTrigger:
      method: POST
      path: /deploy
  - id: act
    bash: "echo received"
    depends_on: [trigger]
`;
    const r = await synthWorkflowFromIntent(
      { intent: 'webhook handler', preview: true },
      { callLLM: makeLlmStub([yaml]) },
    );
    expect(r.ok).toBe(true);
    expect(r.triggerSummary).toBe('webhook: POST /deploy');
  });

  test('describes discord trigger', async () => {
    const yaml = `name: discord-deploy
description: Deploy on discord keyword.
nodes:
  - id: trigger
    discordTrigger:
      kind: message
      channel: ops
      pattern: '^deploy'
  - id: act
    bash: "bun run build"
    depends_on: [trigger]
`;
    const r = await synthWorkflowFromIntent(
      { intent: 'discord deploy', preview: true },
      { callLLM: makeLlmStub([yaml]) },
    );
    expect(r.ok).toBe(true);
    expect(r.triggerSummary).toContain('discord:message');
    expect(r.triggerSummary).toContain('channel=ops');
  });

  test('describes telegram command trigger', async () => {
    const yaml = `name: telegram-summary
description: Reply with summary.
nodes:
  - id: trigger
    telegramTrigger:
      kind: command
      command: summary
  - id: reply
    skill: telegram-reply
    arguments: "today's summary"
    depends_on: [trigger]
`;
    const r = await synthWorkflowFromIntent(
      { intent: 'telegram summary', preview: true },
      { callLLM: makeLlmStub([yaml]) },
    );
    expect(r.ok).toBe(true);
    expect(r.triggerSummary).toContain('telegram:command');
    expect(r.triggerSummary).toContain('command=/summary');
  });

  test('manual workflow (no trigger node) reports trigger=manual', async () => {
    const yaml = `name: manual-task
description: Manual workflow.
nodes:
  - id: run
    bash: "echo hi"
`;
    const r = await synthWorkflowFromIntent(
      { intent: 'manual task', preview: true },
      { callLLM: makeLlmStub([yaml]) },
    );
    expect(r.ok).toBe(true);
    expect(r.triggerSummary).toBe('manual');
  });
});
