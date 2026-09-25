// ── PFC-S4.2 + S4.3 ToolRuntime registration ──

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  ALL_KNOWLEDGE_RUNTIMES,
  knowledgeQueryRuntime,
  knowledgeWriteRuntime,
} from '../src/tool-runtime/knowledge-runtimes';
import {
  getToolRuntime,
  registerToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';

describe('Knowledge runtime registration', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
  });

  test('ALL_KNOWLEDGE_RUNTIMES exposes 2 unique ids', () => {
    expect(ALL_KNOWLEDGE_RUNTIMES.length).toBe(2);
    const ids = ALL_KNOWLEDGE_RUNTIMES.map((rt) => rt.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(['knowledge_query', 'knowledge_write']);
  });

  test('spec names match tool names', () => {
    expect(knowledgeQueryRuntime.spec.name).toBe('KnowledgeQuery');
    expect(knowledgeWriteRuntime.spec.name).toBe('KnowledgeWrite');
  });

  test('registration is idempotent', () => {
    for (const rt of ALL_KNOWLEDGE_RUNTIMES) registerToolRuntime(rt);
    for (const rt of ALL_KNOWLEDGE_RUNTIMES) registerToolRuntime(rt);
    expect(getToolRuntime('knowledge_query')).toBeDefined();
    expect(getToolRuntime('knowledge_write')).toBeDefined();
  });
});
