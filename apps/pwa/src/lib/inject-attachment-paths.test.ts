/**
 * Contract test for inject-attachment-paths — Raycast `ctr.sh` flow의
 * PWA-side. ACP `terminal/input` 호출 + clipboard fallback + POSIX-safe
 * quoting 검증.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import {
  injectAttachmentPathsToTerminal,
  quotePathsForShell,
} from './inject-attachment-paths';

describe('quotePathsForShell — POSIX-safe single-quote escape', () => {
  it('wraps each path in single quotes', () => {
    expect(quotePathsForShell(['/tmp/a.png', '/tmp/b.png'])).toBe(
      "'/tmp/a.png' '/tmp/b.png'",
    );
  });

  it("escapes inner single quotes as '\\''", () => {
    expect(quotePathsForShell(["/tmp/it's.png"])).toBe(
      "'/tmp/it'\\''s.png'",
    );
  });

  it('preserves spaces and unicode in path segments', () => {
    expect(quotePathsForShell(['/tmp/내 파일.png'])).toBe(
      "'/tmp/내 파일.png'",
    );
  });

  it('drops empty/non-string entries', () => {
    expect(
      quotePathsForShell(['/tmp/a.png', '', '/tmp/b.png'] as readonly string[]),
    ).toBe("'/tmp/a.png' '/tmp/b.png'");
  });

  it('returns empty string when all paths are empty', () => {
    expect(quotePathsForShell([])).toBe('');
    expect(quotePathsForShell(['', ''])).toBe('');
  });
});

interface AcpCall {
  method: string;
  params: Record<string, unknown>;
}

function makeAcpStub(opts: { fail?: boolean } = {}): {
  calls: AcpCall[];
  send: (m: string, p: Record<string, unknown>) => Promise<unknown>;
} {
  const calls: AcpCall[] = [];
  return {
    calls,
    send: async (method, params) => {
      calls.push({ method, params });
      if (opts.fail) throw new Error('terminal/input failed');
      return { delivered: true, bytes: 0 };
    },
  };
}

const realNavigator = (globalThis as { navigator?: unknown }).navigator;
let clipboardWrites: string[] = [];

function installClipboardStub(opts: { fail?: boolean } = {}): void {
  clipboardWrites = [];
  (globalThis as { navigator: unknown }).navigator = {
    clipboard: {
      writeText: async (text: string) => {
        if (opts.fail) throw new Error('insecure context');
        clipboardWrites.push(text);
      },
    },
  };
}

function uninstallClipboardStub(): void {
  if (realNavigator === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator;
  } else {
    (globalThis as { navigator: unknown }).navigator = realNavigator;
  }
}

describe('injectAttachmentPathsToTerminal', () => {
  afterEach(() => uninstallClipboardStub());

  it('sends `terminal/input` with quoted paths + trailing space + peerId', async () => {
    const acp = makeAcpStub();
    installClipboardStub();
    const result = await injectAttachmentPathsToTerminal({
      acp,
      sessionId: 's-1',
      terminalId: 'term-1',
      paths: ['/tmp/a.png', '/tmp/b.png'],
    });
    expect(result.injected).toBe(true);
    expect(acp.calls.length).toBe(1);
    expect(acp.calls[0]!.method).toBe('terminal/input');
    expect(acp.calls[0]!.params.sessionId).toBe('s-1');
    expect(acp.calls[0]!.params.terminalId).toBe('term-1');
    expect(acp.calls[0]!.params.data).toBe("'/tmp/a.png' '/tmp/b.png' ");
    expect(typeof acp.calls[0]!.params.peerId).toBe('string');
  });

  it('skips entirely when there are no valid paths', async () => {
    const acp = makeAcpStub();
    const result = await injectAttachmentPathsToTerminal({
      acp,
      sessionId: 's-1',
      terminalId: 'term-1',
      paths: [],
    });
    expect(result).toEqual({ injected: false, copied: false });
    expect(acp.calls.length).toBe(0);
  });

  it('returns injected=false on ACP send failure (silent debug.log)', async () => {
    const acp = makeAcpStub({ fail: true });
    installClipboardStub();
    const result = await injectAttachmentPathsToTerminal({
      acp,
      sessionId: 's-1',
      terminalId: 'term-1',
      paths: ['/tmp/a.png'],
    });
    expect(result.injected).toBe(false);
  });

  it('writes the same string to navigator.clipboard when alsoCopy=true', async () => {
    const acp = makeAcpStub();
    installClipboardStub();
    await injectAttachmentPathsToTerminal({
      acp,
      sessionId: 's-1',
      terminalId: 'term-1',
      paths: ['/tmp/a.png'],
    });
    expect(clipboardWrites).toEqual(["'/tmp/a.png'"]);
  });

  it('skips clipboard when alsoCopyToClipboard=false (caller drove its own write)', async () => {
    const acp = makeAcpStub();
    installClipboardStub();
    const result = await injectAttachmentPathsToTerminal({
      acp,
      sessionId: 's-1',
      terminalId: 'term-1',
      paths: ['/tmp/a.png'],
      alsoCopyToClipboard: false,
    });
    expect(result.copied).toBe(false);
    expect(clipboardWrites.length).toBe(0);
  });

  it('treats clipboard.writeText failure as a silent skip (insecure-context Safari)', async () => {
    const acp = makeAcpStub();
    installClipboardStub({ fail: true });
    const result = await injectAttachmentPathsToTerminal({
      acp,
      sessionId: 's-1',
      terminalId: 'term-1',
      paths: ['/tmp/a.png'],
    });
    expect(result.injected).toBe(true);
    expect(result.copied).toBe(false);
  });
});
