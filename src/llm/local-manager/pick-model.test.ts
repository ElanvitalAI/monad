import { describe, it, expect } from 'bun:test';
import type { LlmInventory, LlmModel } from './types.js';
import { pickLocalModel, scoreLocalModel, DEFAULT_LOCAL_FLEET_POLICY, GiB } from './pick-model.js';

const model = (over: Partial<LlmModel> & { id: string; nodeId: string; runtime: LlmModel['runtime'] }): LlmModel => ({
  label: over.id, ...over,
} as LlmModel);

const inv = (models: LlmModel[], nodes = ['ultra', 'm5']): LlmInventory => ({
  nodes: nodes.map((id) => ({ id, label: id, isLocal: id === 'ultra', reachable: true, runtimes: [], lastProbedAt: 1 } as never)),
  models, at: 1, cached: false, warnings: [],
} as LlmInventory);

describe('pickLocalModel — fleet 정책 auto-pick(2026-07-15)', () => {
  it('MLX 런타임 우선(동일 모델 다른 런타임)', () => {
    const pick = pickLocalModel(inv([
      model({ id: 'gemma-4', nodeId: 'ultra', runtime: 'ollama' }),
      model({ id: 'gemma-4', nodeId: 'ultra', runtime: 'mlx' }),
    ]));
    expect(pick!.runtime).toBe('mlx');
  });

  it('Q4 양자화 선호', () => {
    const pick = pickLocalModel(inv([
      model({ id: 'qwen-32b-q8', nodeId: 'ultra', runtime: 'mlx' }),
      model({ id: 'qwen-32b-q4', nodeId: 'ultra', runtime: 'mlx' }),
    ]));
    expect(pick!.id).toBe('qwen-32b-q4');
  });

  it('MoE 스피드 힌트 가점(gemma-4 35b MoE)', () => {
    const pick = pickLocalModel(inv([
      model({ id: 'dense-70b-q4', nodeId: 'ultra', runtime: 'mlx' }),
      model({ id: 'gemma-4-35b-a4b-moe-q4', nodeId: 'ultra', runtime: 'mlx' }),
    ]));
    expect(pick!.id).toBe('gemma-4-35b-a4b-moe-q4');
  });

  it('노드 RAM 예산 — M5 Max ≤30GB 초과 모델 제외', () => {
    const policy = { ...DEFAULT_LOCAL_FLEET_POLICY, nodeBudgetBytes: { m5: 30 * GiB } };
    const pick = pickLocalModel(inv([
      model({ id: 'huge-q4', nodeId: 'm5', runtime: 'mlx', sizeBytes: 80 * GiB }), // 예산 초과
      model({ id: 'small-q4', nodeId: 'm5', runtime: 'mlx', sizeBytes: 20 * GiB }),
    ]), { policy });
    expect(pick!.id).toBe('small-q4'); // 30GB 초과 huge 제외
  });

  it('M3 Ultra(무예산)는 대형 허용', () => {
    const policy = { ...DEFAULT_LOCAL_FLEET_POLICY, nodeBudgetBytes: { m5: 30 * GiB } };
    const pick = pickLocalModel(inv([
      model({ id: 'huge-q4', nodeId: 'ultra', runtime: 'mlx', sizeBytes: 200 * GiB }),
    ]), { policy });
    expect(pick!.id).toBe('huge-q4'); // ultra 는 예산 미지정→허용
  });

  it('임베딩 제외 · predicate 필터', () => {
    expect(pickLocalModel(inv([model({ id: 'nomic-embed', nodeId: 'ultra', runtime: 'mlx' })]))).toBeNull();
    const pick = pickLocalModel(inv([
      model({ id: 'chat-a', nodeId: 'ultra', runtime: 'mlx' }),
      model({ id: 'chat-b', nodeId: 'ultra', runtime: 'mlx' }),
    ]), { predicate: (m) => m.id === 'chat-b' });
    expect(pick!.id).toBe('chat-b');
  });

  it('unreachable 노드 제외 · 후보 없으면 null', () => {
    const i = {
      nodes: [{ id: 'ultra', label: 'ultra', isLocal: true, reachable: false, runtimes: [], lastProbedAt: 1 }],
      models: [model({ id: 'x', nodeId: 'ultra', runtime: 'mlx' })], at: 1, cached: false, warnings: [],
    } as unknown as LlmInventory;
    expect(pickLocalModel(i)).toBeNull();
  });

  it('scoreLocalModel — MLX+Q4+MoE+loaded 누적', () => {
    const s = scoreLocalModel(model({ id: 'gemma-moe-q4', nodeId: 'ultra', runtime: 'mlx', format: 'mlx', loaded: true }), DEFAULT_LOCAL_FLEET_POLICY);
    const s0 = scoreLocalModel(model({ id: 'plain', nodeId: 'ultra', runtime: 'docker' }), DEFAULT_LOCAL_FLEET_POLICY);
    expect(s).toBeGreaterThan(s0);
  });
});
