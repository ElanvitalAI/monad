// DM stage 3 FU (HANDOFF §3.2 · 2026-05-09) — render-contract tests
// for the activity pill + expandable tool list. Pattern mirror:
// HitlBanner.test.tsx — renderToStaticMarkup, grep the structural
// markers a broken renderer would lose. Interaction-side correctness
// (state transitions on tool events, ordering) is covered by the
// pure-helper suite in `apps/pwa/src/lib/showroom/runtime.test.ts`.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShowroomPanelView } from './ShowroomPanel';
import type { ShowroomPanel } from '@/lib/showroom/types';
import type { ToolCallState } from '@/lib/showroom/types';

// Minimal `DaemonClient` stub — ShowroomPanelView only forwards it; no
// methods are invoked in render. The cast lets us avoid pulling the
// full DaemonClient construction graph into a render test.
const stubClient = {} as unknown as Parameters<typeof ShowroomPanelView>[0]['client'];

const basePanel: ShowroomPanel = {
  id: 'p-test-1',
  kind: 'agent',
  provider: 'codex',
  agentBrand: 'codex',
  sessionId: 'sess-1',
  state: 'live',
};

function makeToolCall(over: Partial<ToolCallState> & Pick<ToolCallState, 'id' | 'status'>): ToolCallState {
  return {
    name: '',
    startedAt: 1_000,
    updatedAt: 1_000,
    ...over,
  };
}

describe('ShowroomPanelView · DM stage 3 FU activity pill', () => {
  it('hides the pill when no tool calls have arrived', () => {
    const html = renderToStaticMarkup(
      <ShowroomPanelView
        panel={basePanel}
        allPanels={[basePanel]}
        client={stubClient}
        onClose={() => {}}
        onState={() => {}}
        onProvider={() => {}}
        dmState={{
          messages: [],
          partial: '',
          streaming: false,
          error: null,
          toolCalls: {},
        }}
        dmSessionId={null}
      />,
    );
    expect(html).not.toMatch(/showroom-panel-tools-pill-/);
    expect(html).not.toMatch(/showroom-panel-tools-list-/);
  });

  it('renders the pill with running suffix when at least one tool is in-flight', () => {
    const html = renderToStaticMarkup(
      <ShowroomPanelView
        panel={basePanel}
        allPanels={[basePanel]}
        client={stubClient}
        onClose={() => {}}
        onState={() => {}}
        onProvider={() => {}}
        dmState={{
          messages: [],
          partial: '',
          streaming: true,
          error: null,
          toolCalls: {
            tc1: makeToolCall({ id: 'tc1', name: 'read_file', status: 'completed' }),
            tc2: makeToolCall({ id: 'tc2', name: 'grep', status: 'in_progress', startedAt: 1_001 }),
          },
        }}
        dmSessionId={null}
      />,
    );
    expect(html).toMatch(/data-testid="showroom-panel-tools-pill-p-test-1"/);
    expect(html).toContain('2 tools');
    expect(html).toContain('1 running');
    // Singular/plural handling — single-tool case has no "s".
    const single = renderToStaticMarkup(
      <ShowroomPanelView
        panel={basePanel}
        allPanels={[basePanel]}
        client={stubClient}
        onClose={() => {}}
        onState={() => {}}
        onProvider={() => {}}
        dmState={{
          messages: [],
          partial: '',
          streaming: false,
          error: null,
          toolCalls: {
            tc1: makeToolCall({ id: 'tc1', name: 'read_file', status: 'completed' }),
          },
        }}
        dmSessionId={null}
      />,
    );
    expect(single).toContain('1 tool');
    expect(single).not.toContain('1 tools');
  });

  it('omits the running suffix when every tool has finished', () => {
    const html = renderToStaticMarkup(
      <ShowroomPanelView
        panel={basePanel}
        allPanels={[basePanel]}
        client={stubClient}
        onClose={() => {}}
        onState={() => {}}
        onProvider={() => {}}
        dmState={{
          messages: [],
          partial: '',
          streaming: false,
          error: null,
          toolCalls: {
            tc1: makeToolCall({ id: 'tc1', name: 'read_file', status: 'completed' }),
            tc2: makeToolCall({ id: 'tc2', name: 'bash', status: 'failed' }),
          },
        }}
        dmSessionId={null}
      />,
    );
    expect(html).toContain('2 tools');
    expect(html).not.toContain('running');
  });

  it('keeps the expandable list collapsed by default (renderToStaticMarkup snapshot)', () => {
    // The list is gated behind `toolListOpen` (initial false) so the
    // SSR snapshot must NOT contain the list section. Click-to-expand
    // is interaction state · covered by manual + dogfood (Group K).
    const html = renderToStaticMarkup(
      <ShowroomPanelView
        panel={basePanel}
        allPanels={[basePanel]}
        client={stubClient}
        onClose={() => {}}
        onState={() => {}}
        onProvider={() => {}}
        dmState={{
          messages: [],
          partial: '',
          streaming: true,
          error: null,
          toolCalls: {
            tc1: makeToolCall({ id: 'tc1', name: 'read_file', status: 'completed' }),
          },
        }}
        dmSessionId={null}
      />,
    );
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toMatch(/showroom-panel-tools-list-/);
  });
});
