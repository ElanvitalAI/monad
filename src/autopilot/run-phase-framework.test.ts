// 축D D1 runPhase 프레임워크 레지스트리 단위테스트 — 기본 해석=현행 이진 if 와 동일·확장·폴백.
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  resolvePhaseFramework,
  registerPhaseFramework,
  listPhaseFrameworks,
  resetPhaseFrameworks,
} from './run-phase-framework.js';

describe('resolvePhaseFramework — 기본 2전략(비파괴 폴백)', () => {
  beforeEach(() => resetPhaseFrameworks());

  it('implementation → se-isolated (현행 이진 if 동일)', () => {
    expect(resolvePhaseFramework({ phaseKind: 'implementation' }).id).toBe('se-isolated');
  });
  it('operational → walker (폴백)', () => {
    expect(resolvePhaseFramework({ phaseKind: 'operational' }).id).toBe('walker');
  });
  it('기본 레지스트리는 [se-isolated, walker]', () => {
    expect(listPhaseFrameworks().map((s) => s.id)).toEqual(['se-isolated', 'walker']);
  });
});

describe('registerPhaseFramework — D2 확장(walker 폴백 앞 삽입)', () => {
  beforeEach(() => resetPhaseFrameworks());

  it('새 전략은 walker 폴백 앞에 삽입돼 우선순위 유지', () => {
    registerPhaseFramework({
      id: 'swarm',
      label: 'showroom lanes(P2P swarm)',
      matches: (c) => c.config?.swarm === true,
    });
    expect(listPhaseFrameworks().map((s) => s.id)).toEqual(['se-isolated', 'swarm', 'walker']);
    // config.swarm 이면 swarm 이 walker 보다 먼저 매치.
    expect(resolvePhaseFramework({ phaseKind: 'operational', config: { swarm: true } }).id).toBe('swarm');
    // 없으면 종전대로 walker.
    expect(resolvePhaseFramework({ phaseKind: 'operational' }).id).toBe('walker');
    // implementation 은 여전히 se-isolated(최우선).
    expect(resolvePhaseFramework({ phaseKind: 'implementation', config: { swarm: true } }).id).toBe('se-isolated');
  });

  it('reset 후 기본 2전략 복귀', () => {
    registerPhaseFramework({ id: 'x', label: 'x', matches: () => true });
    resetPhaseFrameworks();
    expect(listPhaseFrameworks().map((s) => s.id)).toEqual(['se-isolated', 'walker']);
  });
});
