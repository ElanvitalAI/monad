// W9 Z6 · workflow design studio 4-lane + YAML extraction + validation.

import { describe, expect, test } from 'bun:test';
import {
  runWorkflowDesignStudio,
  type DesignLaneSpec,
} from '../../src/showroom/workflow-design-studio';
import {
  handleWorkflowDesign,
  parseWorkflowDesignPath,
} from '../../src/nexus/api/workflow-design';
import type { ShowroomLaneCallable } from '../../src/task-orchestrator/surfaces/showroom-surface';

const LANES: DesignLaneSpec[] = [
  { role: 'architect', model: 'm-a' },
  { role: 'executor', model: 'm-e' },
  { role: 'critic', model: 'm-c' },
  { role: 'tester', model: 'm-t' },
];

const VALID_YAML = `name: demo-wf
description: demo
nodes:
  - id: a
    prompt: hi`;

const INVALID_YAML = `name: BadName
description: demo
nodes: []`;

function fakeCallable(answers: Record<string, string>): ShowroomLaneCallable {
  return async (input) => {
    return { text: answers[input.model] ?? answers['*'] ?? '', modelId: input.model };
  };
}

describe('runWorkflowDesignStudio', () => {
  test('executor YAML preferred when both architect + executor return YAML', async () => {
    const callable = fakeCallable({
      'm-a': '```yaml\nname: a-wf\ndescription: arch\nnodes:\n  - id: x\n    prompt: hi\n```',
      'm-e': `\`\`\`yaml\n${VALID_YAML}\n\`\`\``,
      'm-c': '- risk one\n- risk two',
      'm-t': '- check: alpha: 1 → 2',
    });
    const r = await runWorkflowDesignStudio(
      { goal: 'build demo', lanes: LANES },
      { laneCallable: callable, now: () => 999 },
    );
    expect(r.lanes.length).toBe(4);
    expect(r.proposedYaml).toContain('name: demo-wf');
    expect(r.proposal?.ok).toBe(true);
    expect(r.openIssues).toContain('risk one');
    expect(r.openIssues.some((s) => s.startsWith('tester:'))).toBe(true);
    expect(r.createdAt).toBe(999);
  });

  test('architect YAML used when executor returns commentary only', async () => {
    const callable = fakeCallable({
      'm-a': `\`\`\`yaml\n${VALID_YAML}\n\`\`\``,
      'm-e': 'no yaml here',
      'm-c': '- issue',
      'm-t': '- check: x: y → z',
    });
    const r = await runWorkflowDesignStudio({ goal: 'g', lanes: LANES }, { laneCallable: callable });
    expect(r.proposedYaml).toContain('name: demo-wf');
    expect(r.proposal?.ok).toBe(true);
  });

  test('invalid YAML proposal → ok=false + issues populated', async () => {
    const callable = fakeCallable({
      'm-e': `\`\`\`yaml\n${INVALID_YAML}\n\`\`\``,
      '*': '',
    });
    const r = await runWorkflowDesignStudio({ goal: 'g', lanes: LANES }, { laneCallable: callable });
    expect(r.proposal?.ok).toBe(false);
    expect(r.proposal?.issues.length).toBeGreaterThan(0);
  });

  test('no YAML anywhere → proposedYaml=null + proposal=null', async () => {
    const callable = fakeCallable({ '*': 'commentary only' });
    const r = await runWorkflowDesignStudio({ goal: 'g', lanes: LANES }, { laneCallable: callable });
    expect(r.proposedYaml).toBeNull();
    expect(r.proposal).toBeNull();
  });

  test('lane error is dropped, other lanes preserved', async () => {
    const callable: ShowroomLaneCallable = async (input) => {
      if (input.model === 'm-a') throw new Error('boom');
      return { text: `\`\`\`yaml\n${VALID_YAML}\n\`\`\`` };
    };
    const r = await runWorkflowDesignStudio({ goal: 'g', lanes: LANES }, { laneCallable: callable });
    expect(r.lanes.length).toBe(3);
    expect(r.lanes.find((l) => l.role === 'architect')).toBeUndefined();
  });

  test('currentYaml is threaded into lane prompts', async () => {
    const seen: string[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      seen.push(input.prompt);
      return { text: '' };
    };
    await runWorkflowDesignStudio(
      { goal: 'g', currentYaml: 'name: existing\ndescription: x\nnodes: []', lanes: [LANES[0]!] },
      { laneCallable: callable },
    );
    expect(seen[0]).toContain('Current workflow YAML:');
    expect(seen[0]).toContain('name: existing');
  });
});

describe('workflow-design endpoint', () => {
  test('parseWorkflowDesignPath round-trip', () => {
    expect(parseWorkflowDesignPath('/v1/workflows/demo-wf/design')).toBe('demo-wf');
    expect(parseWorkflowDesignPath('/v1/workflows/x/y')).toBeNull();
  });

  test('POST runs the studio and returns the report', async () => {
    const callable = fakeCallable({
      'm-e': `\`\`\`yaml\n${VALID_YAML}\n\`\`\``,
      '*': '',
    });
    const res = await handleWorkflowDesign(
      new Request('http://localhost/v1/workflows/demo-wf/design', {
        method: 'POST',
        body: JSON.stringify({ goal: 'build a demo' }),
        headers: { 'content-type': 'application/json' },
      }),
      'demo-wf',
      {
        loadCurrentYaml: async () => null,
        showroomDeps: { laneCallable: callable },
        lanes: [
          { role: 'architect', model: 'm-a' },
          { role: 'executor', model: 'm-e' },
          { role: 'critic', model: 'm-c' },
          { role: 'tester', model: 'm-t' },
        ],
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { proposedYaml: string | null };
    expect(body.proposedYaml).toContain('demo-wf');
  });

  test('GET → 405', async () => {
    const res = await handleWorkflowDesign(
      new Request('http://localhost/v1/workflows/x/design'),
      'x',
      { loadCurrentYaml: async () => null, showroomDeps: { laneCallable: async () => ({ text: '' }) } },
    );
    expect(res.status).toBe(405);
  });

  test('POST without goal → 400', async () => {
    const res = await handleWorkflowDesign(
      new Request('http://localhost/v1/workflows/x/design', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      'x',
      { loadCurrentYaml: async () => null, showroomDeps: { laneCallable: async () => ({ text: '' }) } },
    );
    expect(res.status).toBe(400);
  });
});
