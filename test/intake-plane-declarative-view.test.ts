import { describe, expect, test } from 'bun:test';

import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { Size } from '../src/ui/view.js';
import {
  buildIntakeDeclarativeSpec,
  createIntakeDeclarativeRuntimeArtifact,
} from '../src/intake-plane/declarative-view.js';
import { createIntakeStore } from '../src/intake-plane/store.js';
import { createTextChannelIntakeRecord } from '../src/intake-plane/adapters/text.js';
import { createVoiceIntakeRecord } from '../src/intake-plane/adapters/voice.js';
import { captureAndDraftIntakeRecord } from '../src/intake-plane/capture.js';

function renderArtifact(
  artifact: ReturnType<typeof createIntakeDeclarativeRuntimeArtifact>,
  size: Size = { width: 48, height: 10 },
): string[] {
  if (artifact.kind !== 'view') throw new Error(`expected view artifact, got ${artifact.kind}`);
  const printer = Printer.create({ width: size.width, height: size.height, focused: true });
  artifact.view.layout(size);
  artifact.view.takeFocus('front');
  artifact.view.draw(printer);
  return printer.lines().map(stripAnsi);
}

describe('intake declarative view adapter', () => {
  test('builds request-user-input spec for all clarify questions', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, createTextChannelIntakeRecord({
      intakeId: 'intake-q',
      source: 'telegram',
      text: '====',
      receivedAt: '2026-04-30T12:00:00.000Z',
    }));
    session.draft?.openQuestions.push({
      id: 'followup',
      scope: 'bundle',
      question: 'Which repo should lead?',
      reason: 'Need ordering context',
    });
    const spec = buildIntakeDeclarativeSpec(session);
    expect(spec.type).toBe('intake-review');
    expect(spec.chrome?.title).toContain('Clarify intake');
    const questions = spec.config?.questions as Array<{ id: string; title: string }>;
    expect(questions.map((question) => question.id)).toEqual(
      session.draft?.openQuestions.map((question) => question.id),
    );
  });

  test('builds dialog spec for review-ready intake', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, createVoiceIntakeRecord({
      intakeId: 'intake-review',
      transcript: 'compare two repos',
      receivedAt: '2026-04-30T12:00:00.000Z',
    }));
    const spec = buildIntakeDeclarativeSpec(session);
    expect(spec.type).toBe('intake-review');
    const actions = spec.config?.actions as Array<{ label: string; value: { kind: string; intakeId: string } }>;
    expect(actions.map((action) => action.label)).toEqual([
      'Apply now',
      'Keep in backlog',
      'Generate task proposal',
    ]);
    expect(actions[0]?.value).toMatchObject({
      kind: 'decide-apply-now',
      intakeId: 'intake-review',
    });
  });

  test('materializes a built-in declarative view artifact', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, createVoiceIntakeRecord({
      intakeId: 'intake-view',
      transcript: 'compare two repos',
      receivedAt: '2026-04-30T12:00:00.000Z',
    }));
    const artifact = createIntakeDeclarativeRuntimeArtifact(session);
    expect(artifact.kind).toBe('view');
    const joined = renderArtifact(artifact).join('\n');
    expect(joined).toContain('Review intake');
    expect(joined).toContain('compare two repos');
    expect(joined).toContain('Apply now');
  });
});
