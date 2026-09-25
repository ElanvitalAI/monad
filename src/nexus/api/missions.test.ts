import { describe, expect, it } from 'bun:test';
import { summarise } from './missions.js';
import { createMission } from '../../task-orchestrator/mission.js';

describe('summarise — MissionCardWire autopilot 노출 (U1)', () => {
  it('자율 Mission 은 autopilot 메타를 카드에 담는다', () => {
    const m = createMission(
      {
        title: '반도체 아침 리포트',
        intent: '반도체 아침 리포트',
        source: { kind: 'manual', raw: '반도체 아침 리포트' },
        goalSlug: 'apm_x_semis_abc123',
        autopilot: {
          apmId: 'apm_x_semis_abc123',
          origin: 'discovery',
          executionModel: 'scheduler',
          apmStatus: 'armed',
          engine: 'schedule_manage',
        },
      },
      { now: 1000, id: 'apm_x_semis_abc123' },
    );
    const card = summarise(m, []);
    expect(card.id).toBe('apm_x_semis_abc123');
    expect(card.autopilot).not.toBeNull();
    expect(card.autopilot?.origin).toBe('discovery');
    expect(card.autopilot?.executionModel).toBe('scheduler');
    expect(card.autopilot?.apmStatus).toBe('armed');
    expect(card.autopilot?.apmId).toBe('apm_x_semis_abc123');
    expect(card.taskCount).toBe(0);
  });

  it('사람이 만든 일반 Mission 은 autopilot=null', () => {
    const m = createMission(
      { title: '사람 미션', source: { kind: 'manual' } },
      { now: 1000 },
    );
    const card = summarise(m, []);
    expect(card.autopilot).toBeNull();
    expect(card.status).toBe('planning');
  });
});
