import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createTask } from '../task-orchestrator/types.js';
import { openSchedulesDb } from '../domains/schedule-registry.js';
import { openSurfaceEventsDb } from '../domains/surface-events.js';
import { registerLoopAgent } from '../domains/loop-agent-registry.js';
import { missionResources } from './mission-resources.js';

const MID = 'apm_res_test';

function seed() {
  const store = new TaskStore({ path: ':memory:', noWal: true });
  const t1 = createTask({ title: '페이즈 A', surface: { kind: 'subagent', definitionName: 'g', prompt: 'A' }, dependsOn: [] }, { id: 'task:a', now: 1 });
  t1.goalSlug = MID; t1.status = 'done'; t1.notes = ['[SE-PR] https://github.com/x/y/pull/100']; store.saveTask(t1);
  const t2 = createTask({ title: '페이즈 B', surface: { kind: 'subagent', definitionName: 'g', prompt: 'B' }, dependsOn: [] }, { id: 'task:b', now: 2 });
  t2.goalSlug = MID; t2.status = 'ready'; store.saveTask(t2);
  const sdb = openSchedulesDb(':memory:');
  sdb.run(`INSERT INTO schedule_registry(id,name,source,cron,command,category,enabled,autopilot_id) VALUES('cron1','nightly','crontab','30 3 * * *','bun x.ts','maintenance',1,?)`, [MID]);
  sdb.run(`INSERT INTO schedule_registry(id,name,source,cron,command,category,enabled,autopilot_id) VALUES('cron2','other','crontab','0 9 * * *','bun z.ts','maintenance',1,'apm_other')`);
  const ldb = openSurfaceEventsDb(':memory:');
  registerLoopAgent(ldb, { loopId: 'lev', name: '레버 계약루프', summary: 's', loopKind: 'contract', lifecycle: 'permanent', missionId: MID, scheduleIds: ['cron1'] });
  registerLoopAgent(ldb, { loopId: 'other', name: '남의루프', summary: 's', loopKind: 'autonomous', lifecycle: 'ephemeral', missionId: 'apm_other' });
  return { store, sdb, ldb };
}

describe('missionResources — 자기 자산 역추적', () => {
  it('미션ID로 태스크+크론+루프 역추적·링크', () => {
    const { store, sdb, ldb } = seed();
    const led = missionResources(MID, { store, scheduleDb: sdb, loopDb: ldb });
    expect(led.tasks).toHaveLength(2);
    expect(led.tasks[0]!.title).toBe('페이즈 A');
    expect(led.tasks[0]!.prUrl).toContain('pull/100');
    expect(led.crons).toHaveLength(1); // 이 미션 크론만(apm_other 제외)
    expect(led.crons[0]!.id).toBe('cron1');
    expect(led.loopAgents).toHaveLength(1); // 이 미션 루프만
    expect(led.loopAgents[0]!.loopKind).toBe('contract');
    expect(led.loopAgents[0]!.scheduleIds).toEqual(['cron1']);
    expect(led.prRefs).toEqual(['https://github.com/x/y/pull/100']); // 부가정보
    store.close(); sdb.close(); ldb.close();
  });
  it('자원 없는 미션은 빈 원장', () => {
    const { store, sdb, ldb } = seed();
    const led = missionResources('apm_none', { store, scheduleDb: sdb, loopDb: ldb });
    expect(led.tasks).toHaveLength(0);
    expect(led.crons).toHaveLength(0);
    expect(led.loopAgents).toHaveLength(0);
    store.close(); sdb.close(); ldb.close();
  });
});
