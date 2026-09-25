import { describe, it, expect } from 'bun:test';
import {
  resolveRoleFromEnv, normalizeRole, normalizeExecutorKind, describeRole, HARNESS_ROLE_MAP,
} from './roles.js';

describe('resolveRoleFromEnv — Docker 롤(env 로 결정)', () => {
  it('미지정 → executor:self(기본)', () => {
    const c = resolveRoleFromEnv({});
    expect(c.role).toBe('executor');
    expect(c.executorKind).toBe('self');
  });

  it('MONAD_ROLE=controller → controller(executorKind 없음)', () => {
    const c = resolveRoleFromEnv({ MONAD_ROLE: 'controller' });
    expect(c.role).toBe('controller');
    expect(c.executorKind).toBeUndefined();
  });

  it('executor + agent backend', () => {
    const c = resolveRoleFromEnv({ MONAD_ROLE: 'executor', MONAD_EXECUTOR_KIND: 'agent', MONAD_AGENT_BACKEND: 'codex' });
    expect(c.role).toBe('executor');
    expect(c.executorKind).toBe('agent');
    expect(c.agentBackend).toBe('codex');
  });

  it('executor:skill', () => {
    expect(resolveRoleFromEnv({ MONAD_EXECUTOR_KIND: 'skill' }).executorKind).toBe('skill');
  });

  it('orchestrator', () => {
    expect(resolveRoleFromEnv({ MONAD_ROLE: 'orchestrator' }).role).toBe('orchestrator');
  });
});

describe('정규화 — 부적합 폴백', () => {
  it('부적합 롤 → executor, 부적합 kind → self', () => {
    expect(normalizeRole('nonsense')).toBe('executor');
    expect(normalizeExecutorKind('nonsense')).toBe('self');
  });
});

describe('describeRole', () => {
  it('executor:agent(codex)·executor:self·orchestrator', () => {
    expect(describeRole({ role: 'executor', executorKind: 'agent', agentBackend: 'codex' })).toBe('executor:agent(codex)');
    expect(describeRole({ role: 'executor', executorKind: 'self' })).toBe('executor:self');
    expect(describeRole({ role: 'orchestrator' })).toBe('orchestrator');
  });
});

describe('HARNESS_ROLE_MAP — 3 harness + orchestrator 통합 target', () => {
  it('4개 harness 를 롤로 매핑', () => {
    const byHarness = Object.fromEntries(HARNESS_ROLE_MAP.map((d) => [d.harness, d]));
    expect(byHarness['self-implement']!.executorKind).toBe('self');
    expect(byHarness['agent-mission']!.role).toBe('controller');
    expect(byHarness['generic-skill-executor']!.executorKind).toBe('skill');
    expect(byHarness['staged-harness']!.role).toBe('orchestrator');
  });
});
