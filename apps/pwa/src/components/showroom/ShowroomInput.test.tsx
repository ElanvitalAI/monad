// CV-3 Showroom MVP — ShowroomInput render contract.
// Pattern mirror: VoiceOverlay.test.tsx · server-side renderToStaticMarkup
// (PWA bun test env has no React Testing Library — we grep the rendered
// HTML for the structural markers a future broken renderer would lose).

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShowroomInput } from './ShowroomInput';
import type { ShowroomPanel } from '@/lib/showroom/types';

function panel(id: string, provider: string, state: ShowroomPanel['state']): ShowroomPanel {
  return { id, kind: 'chat', provider, sessionId: `sess-${id}`, state };
}

describe('ShowroomInput — render contract (P1+P2)', () => {
  const samplePanels: ShowroomPanel[] = [
    panel('p1', 'claude', 'live'),
    panel('p2', 'gemini', 'live'),
  ];

  it('liveCount=0 — placeholder + "No live panel" send label · button disabled', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={[]} liveCount={0} />,
    );
    expect(html).toContain('mute');
    expect(html).toContain('No live panel');
    // disabled attribute is present on the button when liveCount=0.
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="showroom-send"/);
  });

  it('liveCount>=1 — "Send · N" label + textarea placeholder mentions broadcast', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={2} />,
    );
    expect(html).toContain('Send · 2');
    expect(html).toContain('2 live panel');
    // Send button is initially disabled because text is empty.
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="showroom-send"/);
  });

  it('disabled prop forces textarea + button to disabled', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={2}
        disabled
      />,
    );
    expect(html).toMatch(/<textarea[^>]*disabled[^>]*data-testid="showroom-input"/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="showroom-send"/);
  });

  it('exposes data-testid hooks for the textarea and the send button', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={2} />,
    );
    expect(html).toContain('data-testid="showroom-input"');
    expect(html).toContain('data-testid="showroom-send"');
  });

  it('aria-label on textarea + send button (accessibility)', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={2} />,
    );
    expect(html).toContain('aria-label="Showroom broadcast input"');
    // P2 — aria-label on send button reflects broadcast mode (no mention).
    expect(html).toContain('Broadcast to all live panels');
  });
});

describe('ShowroomInput — attachment chip list (P3)', () => {
  const samplePanels: ShowroomPanel[] = [panel('p1', 'claude', 'live')];
  const meta = (id: string, name: string) => ({
    id,
    filename: name,
    mediaType: 'image/png',
    size: 1024,
    downloadUrl: `/v1/attachments/${id}`,
  });

  it('attachments=[] 일 때 chip list hidden', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        attachments={[]}
      />,
    );
    expect(html).not.toContain('data-testid="showroom-attachment-list"');
  });

  it('attachments 가 있으면 chip list + 각 파일명 표시', () => {
    const atts = [meta('a1', 'mockup.png'), meta('a2', 'spec.pdf')];
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        attachments={atts}
      />,
    );
    expect(html).toContain('data-testid="showroom-attachment-list"');
    expect(html).toContain('data-testid="showroom-attachment-chip-a1"');
    expect(html).toContain('data-testid="showroom-attachment-chip-a2"');
    expect(html).toContain('mockup.png');
    expect(html).toContain('spec.pdf');
  });

  it('onRemoveAttachment 있으면 remove button 노출 + aria-label', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        attachments={[meta('a1', 'photo.jpg')]}
        onRemoveAttachment={() => {}}
      />,
    );
    expect(html).toContain('data-testid="showroom-attachment-remove-a1"');
    expect(html).toContain('aria-label="Remove attachment photo.jpg"');
  });

  it('onRemoveAttachment 없으면 remove button 미노출', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        attachments={[meta('a1', 'photo.jpg')]}
      />,
    );
    expect(html).not.toContain('data-testid="showroom-attachment-remove-a1"');
  });
});

describe('ShowroomInput — mention typeahead (P2.5 · render contract)', () => {
  // typeahead dropdown 은 cursor pos 기반 dynamic state 라 server-side
  // render 에서는 항상 hidden (initial text='', no cursor). 따라서
  // initial render 에 dropdown 이 없어야 함. interactive case 는 사용자
  // dogfood / future RTL test 에서.

  const samplePanels: ShowroomPanel[] = [panel('p1', 'claude', 'live')];

  it('initial render — typeahead dropdown not visible (no cursor state)', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={1} />,
    );
    expect(html).not.toContain('data-testid="showroom-mention-typeahead"');
  });
});

describe('ShowroomInput — prior-answer promotion (DM-3)', () => {
  const samplePanels: ShowroomPanel[] = [panel('p1', 'claude', 'live')];
  const pa = (id: string, label: string, overrides: Partial<{ turnNumber: number; enabled: boolean }> = {}) => ({
    id,
    label,
    text: 'sample answer',
    sourcePanelId: 'p1',
    sourceProvider: 'claude',
    promotedAt: 0,
    turnNumber: overrides.turnNumber ?? 1,
    enabled: overrides.enabled ?? true,
  });

  it('priorAnswers=[] hidden', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        priorAnswers={[]}
      />,
    );
    expect(html).not.toContain('data-testid="showroom-prior-answer-list"');
  });

  it('renders prior chips with label', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        priorAnswers={[pa('a1', '@codex · 17:30'), pa('a2', '@gemini · 17:32')]}
      />,
    );
    expect(html).toContain('data-testid="showroom-prior-answer-list"');
    expect(html).toContain('data-testid="showroom-prior-chip-a1"');
    expect(html).toContain('@codex · 17:30');
    expect(html).toContain('@gemini · 17:32');
  });

  it('onRemovePriorAnswer 있으면 X button + aria', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        priorAnswers={[pa('a1', 'codex answer')]}
        onRemovePriorAnswer={() => {}}
      />,
    );
    expect(html).toContain('data-testid="showroom-prior-remove-a1"');
    expect(html).toContain('aria-label="Remove prior answer codex answer"');
  });

  // §3.4 (BACKLOG-showroom-cv-3-post-dm-stage-4-2026-05-09).
  it('enabled chip — data-enabled="true" + aria-pressed=true', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        priorAnswers={[pa('a1', 'T1 @codex · 17:30', { enabled: true })]}
        onTogglePriorAnswer={() => {}}
      />,
    );
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-testid="showroom-prior-toggle-a1"');
    expect(html).toContain('aria-label="Disable prior answer T1 @codex · 17:30"');
    expect(html).toContain('T1 @codex · 17:30');
  });

  it('disabled chip — data-enabled="false" + line-through + aria-pressed=false', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        priorAnswers={[pa('a1', 'T2 @gemini · 17:32', { enabled: false })]}
        onTogglePriorAnswer={() => {}}
      />,
    );
    expect(html).toContain('data-enabled="false"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('line-through');
    expect(html).toContain('aria-label="Enable prior answer T2 @gemini · 17:32"');
  });

  it('without onTogglePriorAnswer → label is plain span (no toggle button)', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        priorAnswers={[pa('a1', 'plain label')]}
      />,
    );
    expect(html).not.toContain('data-testid="showroom-prior-toggle-a1"');
    expect(html).toContain('plain label');
  });
});

describe('ShowroomInput — terminal context (P4)', () => {
  const samplePanels: ShowroomPanel[] = [panel('p1', 'claude', 'live')];
  const tc = (id: string, label: string, text: string) => ({
    id,
    label,
    text,
    pinnedAt: 1715000000000,
  });

  it('terminalContexts=[] 일 때 chip list hidden', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        terminalContexts={[]}
      />,
    );
    expect(html).not.toContain('data-testid="showroom-terminal-context-list"');
  });

  it('pinned terminal contexts → chip list + label 표시', () => {
    const ctxs = [
      tc('tc1', 'build error · 17:30', 'error: cannot find module'),
      tc('tc2', 'test fail · 17:32', 'AssertionError: x !== y'),
    ];
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        terminalContexts={ctxs}
      />,
    );
    expect(html).toContain('data-testid="showroom-terminal-context-list"');
    expect(html).toContain('data-testid="showroom-terminal-chip-tc1"');
    expect(html).toContain('data-testid="showroom-terminal-chip-tc2"');
    expect(html).toContain('build error · 17:30');
    expect(html).toContain('test fail · 17:32');
  });

  it('Pin toggle button — onPinTerminalContext 있으면 노출', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        onPinTerminalContext={() => {}}
      />,
    );
    expect(html).toContain('data-testid="showroom-terminal-pin-toggle"');
    expect(html).toContain('aria-label="Pin terminal context"');
  });

  it('onPinTerminalContext 없으면 Pin button 미노출', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={1} />,
    );
    expect(html).not.toContain('data-testid="showroom-terminal-pin-toggle"');
  });

  it('onRemoveTerminalContext 있으면 chip 의 remove button 노출', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput
        onSend={() => {}}
        panels={samplePanels}
        liveCount={1}
        terminalContexts={[tc('tc1', 'output', 'hello')]}
        onRemoveTerminalContext={() => {}}
      />,
    );
    expect(html).toContain('data-testid="showroom-terminal-remove-tc1"');
    expect(html).toContain('aria-label="Remove terminal context output"');
  });
});

describe('ShowroomInput — mention picker (P2)', () => {
  const samplePanels: ShowroomPanel[] = [
    panel('p1', 'claude', 'live'),
    panel('p2', 'gemini', 'live'),
    panel('p3', 'grok', 'mute'),
  ];

  it('renders mention chip for each panel + @all chip', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={2} />,
    );
    expect(html).toContain('data-testid="showroom-mention-picker"');
    expect(html).toContain('data-testid="showroom-mention-chip-claude"');
    expect(html).toContain('data-testid="showroom-mention-chip-gemini"');
    expect(html).toContain('data-testid="showroom-mention-chip-grok"');
    expect(html).toContain('data-testid="showroom-mention-chip-all"');
  });

  it('mention picker hidden when panels list is empty', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={[]} liveCount={0} />,
    );
    expect(html).not.toContain('data-testid="showroom-mention-picker"');
  });

  it('chips include @ prefix in label', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={samplePanels} liveCount={2} />,
    );
    expect(html).toContain('@claude');
    expect(html).toContain('@gemini');
    expect(html).toContain('@grok');
    expect(html).toContain('@all');
  });

  it('D12 numeric suffix — duplicate provider gets @claude-1 / @claude-2', () => {
    const dupPanels: ShowroomPanel[] = [
      panel('p1', 'claude', 'live'),
      panel('p2', 'claude', 'live'),
    ];
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={dupPanels} liveCount={2} />,
    );
    expect(html).toContain('@claude-1');
    expect(html).toContain('@claude-2');
  });

  // ─── P5 — agent CLI panel mention namespace (D3) ─────────────────
  it('P5 — agent panel renders @${brand}-cli chip · disambiguates from chat', () => {
    const mixed: ShowroomPanel[] = [
      panel('p1', 'codex', 'live'), // chat codex
      {
        id: 'a1',
        kind: 'agent',
        provider: 'codex',
        agentBrand: 'codex',
        sessionId: 'sess-a1',
        state: 'live',
      },
    ];
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={mixed} liveCount={2} />,
    );
    expect(html).toContain('@codex'); // chat codex
    expect(html).toContain('@codex-cli'); // agent codex CLI
  });

  it('P5 — multiple same-brand agents → numeric suffix on agent display', () => {
    const dupAgents: ShowroomPanel[] = [
      {
        id: 'a1',
        kind: 'agent',
        provider: 'claude',
        agentBrand: 'claude',
        sessionId: 'sess-a1',
        state: 'live',
      },
      {
        id: 'a2',
        kind: 'agent',
        provider: 'claude',
        agentBrand: 'claude',
        sessionId: 'sess-a2',
        state: 'live',
      },
    ];
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={dupAgents} liveCount={2} />,
    );
    expect(html).toContain('@claude-cli-1');
    expect(html).toContain('@claude-cli-2');
  });
});

describe('ShowroomInput — mention chip viz (hybrid overlay · #1973)', () => {
  const panels3: ShowroomPanel[] = [
    panel('p1', 'claude', 'live'),
    panel('p2', 'gemini', 'live'),
    {
      id: 'a1',
      kind: 'agent',
      provider: 'codex',
      agentBrand: 'codex',
      sessionId: 'sess-a1',
      state: 'live',
    },
  ];

  it('hidden when no mentions in text', () => {
    const html = renderToStaticMarkup(
      <ShowroomInput onSend={() => {}} panels={panels3} liveCount={3} />,
    );
    // empty text · no detected mentions
    expect(html).not.toContain('showroom-mention-detected-strip');
  });

  // Note: ShowroomInput is a controlled-via-state component (text starts
  // empty). renderToStaticMarkup can't simulate user typing, so the
  // detected-strip presence is verified through eval-time tests in the
  // browser dogfood (see TEST-MANUAL doc). Here we only assert the
  // strip's static structural opt-out (no mention → no render).
});
