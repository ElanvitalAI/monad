// Tests for AgentList LLM tool (PFC PX-1 Phase 6).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgentListTool,
  dispatchAgentList,
} from '../src/agent/agent-list-tool.js';
import { nativeToolCatalog } from '../src/native-tool-catalog.js';
import { debug } from '../src/debug/log.js';
import type { AgentDefinition } from '../src/agent/types.js';

describe('buildAgentListTool', () => {
  test('returns LLMToolSpec with empty parameters schema', () => {
    const spec = buildAgentListTool();
    expect(spec.name).toBe('AgentList');
    expect(spec.description).toContain('subagent_type');
    expect(spec.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });
});

describe('dispatchAgentList', () => {
  test('returns entries including the 5 PFC plugin-builtin agents', async () => {
    const res = await dispatchAgentList();
    expect(res.count).toBeGreaterThanOrEqual(5);
    const names = res.agents.map(a => a.name);
    expect(names).toContain('explore');
    expect(names).toContain('plan');
    expect(names).toContain('research');
    expect(names).toContain('critic');
    expect(names).toContain('executor');
  });

  test('each entry has source + model + omitInheritedContext (defaulted)', async () => {
    const res = await dispatchAgentList();
    for (const a of res.agents) {
      expect(a.source).toBeTruthy();
      expect(a.model).toBeTruthy();
      expect(typeof a.omitInheritedContext).toBe('boolean');
      expect(a.toolsCount === null || typeof a.toolsCount === 'number').toBe(true);
    }
  });

  test('output summary includes count + source breakdown', async () => {
    const res = await dispatchAgentList();
    expect(res.output).toMatch(/^\d+ agents: /);
    expect(res.output).toContain('plugin-builtin');
  });

  test('entries sorted alphabetically by name', async () => {
    const res = await dispatchAgentList();
    const names = res.agents.map(a => a.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  test('records a non-empty layered selection with its returned count', async () => {
    debug.enable();
    debug.clear();
    const agent: AgentDefinition = { name: 'fixture-agent', systemPrompt: 'fixture' };

    const result = await dispatchAgentList({}, {
      load: () => ({
        agents: new Map([[agent.name, agent]]),
        report: { registered: 1, overrides: [], warnings: [], errors: [] },
      }),
    });

    const line = debug.tail(10).find(line => line.includes('[agent.list] dispatch'));
    expect(result.count).toBe(1);
    expect(line).toBeDefined();
    expect(line!).toContain('"selection":"layered-registry"');
    expect(line!).toContain('"count":1');
    expect(line!).not.toContain('zeroResultReason');
  });

  test('distinguishes no registered agents from actual layered-registry filtering', async () => {
    debug.enable();
    debug.clear();
    const noRegistered = await dispatchAgentList({}, {
      loadOptions: {
        projectRoot: process.cwd(),
        skipBuiltin: true,
        skipPlugin: true,
        skipUser: true,
        skipProject: true,
      },
    });
    const noRegisteredLine = debug.tail(10).find(line => line.includes('[agent.list] dispatch'));

    const root = mkdtempSync(join(tmpdir(), 'agent-list-filtered-'));
    try {
      const builtinDir = join(root, 'builtin');
      mkdirSync(builtinDir, { recursive: true });
      for (const name of ['alpha', 'beta']) {
        writeFileSync(join(builtinDir, `${name}.md`), `---\nname: ${name}\n---\nfixture`);
      }
      debug.clear();
      const filtered = await dispatchAgentList({}, {
        loadOptions: {
          builtinDir,
          projectRoot: root,
          skipPlugin: true,
          skipUser: true,
          skipProject: true,
          isDisabled: () => true,
        },
      });
      const filteredLine = debug.tail(10).find(line => line.includes('[agent.list] dispatch'));

      expect(noRegistered.count).toBe(0);
      expect(noRegisteredLine).toContain('"count":0');
      expect(noRegisteredLine).toContain('"zeroResultReason":"no_registered_agents"');
      expect(filtered.count).toBe(0);
      expect(filteredLine).toContain('"count":0');
      expect(filteredLine).toContain('"zeroResultReason":"all_registered_agents_filtered"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('AgentList native-catalog entry', () => {
  test('registered with read-only safety + parallel-safe', () => {
    const entry = nativeToolCatalog.find(e => e.id === 'agent_list');
    expect(entry).toBeDefined();
    expect(entry!.safety).toContain('read-only');
    expect(entry!.supportsParallel).toBe(true);
    expect(entry!.defaultEnabled).toBe(true);
    expect(entry!.aliases).toContain('AgentList');
  });
});
