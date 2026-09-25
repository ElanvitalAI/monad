import { describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { TaskFeedbackLoop } from '../src/task-orchestrator/feedback-loop.ts';
import { buildToxLoopSection } from '../src/task-orchestrator/loop-section.ts';
import { createTask, type TaskSurface } from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mkHarness() {
  const graph = new TaskGraph();
  const registry = new SurfaceRegistry();
  const dispatcher = new TaskDispatcher({ graph, registry, bus: new TaskEventBus() });
  return { graph, dispatcher, registry };
}

describe('buildToxLoopSection', () => {
  test('LS1: empty graph + onlyIfNonEmpty → null', () => {
    const { graph } = mkHarness();
    expect(buildToxLoopSection({ graph })).toBeNull();
  });

  test('LS2: has tasks → counts + next-ready + loop line', () => {
    const { graph, dispatcher } = mkHarness();
    graph.addTask(createTask({ title: 'first', surface: surfaceLlm }));
    graph.addTask(createTask({ title: 'second', surface: surfaceLlm }));
    graph.promoteReady();
    const loop = new TaskFeedbackLoop({ graph, dispatcher });
    const md = buildToxLoopSection({ graph, loop });
    expect(md).toBeTruthy();
    expect(md!).toContain('## Task Orchestrator');
    expect(md!).toMatch(/counts: backlog/);
    expect(md!).toMatch(/next-ready:/);
    expect(md!).toContain('first');
    expect(md!).toContain('loop: active');
  });

  test('LS3: paused loop → "paused(<reason>)"', () => {
    const { graph, dispatcher } = mkHarness();
    graph.addTask(createTask({ title: 't', surface: surfaceLlm }));
    const loop = new TaskFeedbackLoop({ graph, dispatcher });
    loop.pause('manual');
    const md = buildToxLoopSection({ graph, loop });
    expect(md).toMatch(/loop: paused\(manual\)/);
  });

  test('LS4: maxTasksShown clamp', () => {
    const { graph, dispatcher } = mkHarness();
    for (let i = 0; i < 6; i++) {
      graph.addTask(createTask({ title: `t${i}`, surface: surfaceLlm }));
    }
    graph.promoteReady();
    const md = buildToxLoopSection({
      graph,
      loop: new TaskFeedbackLoop({ graph, dispatcher }),
      maxTasksShown: 2,
    });
    // "▶ task:xxx — "t0" [llm-direct]" appears at most twice
    const matches = md!.match(/llm-direct/g) ?? [];
    expect(matches.length).toBe(2);
  });

  test('LS5: ready empty → "(none)"', () => {
    const { graph, dispatcher } = mkHarness();
    const t = createTask({ title: 'x', surface: surfaceLlm });
    graph.addTask(t);
    graph.updateTask(t.id, { status: 'cancelled' });
    const md = buildToxLoopSection({
      graph,
      loop: new TaskFeedbackLoop({ graph, dispatcher }),
      onlyIfNonEmpty: false,
    });
    expect(md!).toMatch(/next-ready: \(none\)/);
  });
});
