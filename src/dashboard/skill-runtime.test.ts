import { describe, expect, test } from 'bun:test';

import { FoldStack } from '../fold-stack.js';
import { runDashboardSkillByName } from './skill-runtime.js';
import type { ExecuteSkillOpts } from '../skills/runner.js';

function baseDeps(over: {
  executeSkill: NonNullable<Parameters<typeof runDashboardSkillByName>[2]['executeSkill']>;
  foldMode?: Parameters<typeof runDashboardSkillByName>[2]['foldMode'];
}) {
  const chatLines: string[] = [];
  return {
    chatHistory: [] as const,
    chatLines,
    contextRegistry: {} as never,
    foldStack: new FoldStack({ chatLines }),
    draw: () => {},
    pinChatTail: () => {},
    pushDebugBlank: () => {},
    pushDebugLine: () => {},
    attachStreamingKeys: () => () => {},
    formatSkillResponse: (text: string) => [text],
    skillContextLabel: 'ctx',
    allowAgentsScratch: false,
    showAgentsScratch: () => {},
    publishAgentBatchScratch: () => {},
    parseSkill: (name: string) => ({
      name,
      description: 'demo',
      content: '# demo',
      skillDir: '/tmp/demo-skill',
    }),
    loadAttachments: async () => {},
    ...over,
  };
}

describe('runDashboardSkillByName foldMode seam', () => {
  test('forwards the current foldMode into executeSkill so the runner first-paints with it', async () => {
    let captured: ExecuteSkillOpts | undefined;
    const ran = await runDashboardSkillByName('demo-skill', '', baseDeps({
      foldMode: 'task-unit',
      executeSkill: async (_manifest, _args, _onDelta, opts) => {
        captured = opts;
        return { provider: 'demo', model: 'demo', fullResponse: '' };
      },
    }));

    expect(ran).toBe(true);
    expect(captured?.foldMode).toBe('task-unit');
  });

  test('omitted foldMode leaves executeSkill on the existing line default path', async () => {
    let captured: ExecuteSkillOpts | undefined;
    const ran = await runDashboardSkillByName('demo-skill', '', baseDeps({
      executeSkill: async (_manifest, _args, _onDelta, opts) => {
        captured = opts;
        return { provider: 'demo', model: 'demo', fullResponse: '' };
      },
    }));

    expect(ran).toBe(true);
    expect(captured?.foldMode).toBeUndefined();
  });
});
