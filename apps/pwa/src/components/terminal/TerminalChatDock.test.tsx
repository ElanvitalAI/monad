import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('@/components/providers/DaemonProvider', () => ({
  useDaemon: () => ({
    client: { connectAcp: () => ({ close: () => {} }) },
    config: {},
    setConfig: () => {},
    sessionId: undefined,
    setSessionId: () => {},
  }),
}));

mock.module('@/components/chat/ChatHistory', () => ({
  ChatHistory: () => <div data-chat-history />,
}));

mock.module('@/components/chat/ChatInput', () => ({
  ChatInput: () => <div data-chat-input />,
}));

import { TerminalChatDock } from './TerminalChatDock';

const renderDock = (height?: number): string => renderToStaticMarkup(
  <TerminalChatDock
    terminalId="terminal-1"
    open
    replOpen={false}
    onToggleRepl={() => {}}
    {...(height === undefined ? {} : { height })}
  />,
);

describe('TerminalChatDock (SSR)', () => {
  test('renders a positive parent-provided height without the legacy minimum', () => {
    const html = renderDock(320);
    expect(html).toContain('style="height:320px"');
    expect(html).not.toContain('h-[clamp(160px,30vh,360px)]');
    expect(html).not.toContain('min-h-[200px]');
  });

  test('renders a sub-minimum positive parent-provided height without legacy constraints', () => {
    const html = renderDock(160);
    expect(html).toContain('style="height:160px"');
    expect(html).not.toContain('h-[clamp(160px,30vh,360px)]');
    expect(html).not.toContain('min-h-[200px]');
  });

  test('retains the legacy CSS height budget when no height is provided', () => {
    const html = renderDock();
    expect(html).toContain('h-[clamp(160px,30vh,360px)]');
    expect(html).toContain('min-h-[200px]');
    expect(html).not.toContain('style="height:');
  });

  test('falls back to the legacy CSS height budget for invalid heights', () => {
    for (const height of [0, Infinity]) {
      const html = renderDock(height);
      expect(html).toContain('h-[clamp(160px,30vh,360px)]');
      expect(html).toContain('min-h-[200px]');
      expect(html).not.toContain('style="height:');
    }
  });
});
