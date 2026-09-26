// Step 2 of platform-evolution arc · PR γ — discord bridge
// attachments forward.
//
// Mirrors test/telegram-bridge-attachments.test.ts: verifies that
// attachments passed via runTurn({channelId, attachments}) land in
// the daemon's PromptRequest as ContentBlock[] — image inline,
// resource_link for non-image. Discord-specific concerns: snowflake
// channelId (string) + bindings-first contract (no implicit
// minting; channel must call setDaemonSessionForChannel first).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk';

import { bootAcpServer } from '../src/boot/acp-server.js';
import { createDiscordAcpBridge } from '../src/discord-acp-bridge.js';
import { waitForSocket } from './helpers/wait-for-socket.js';

let tmp: string;
let sockPath: string;
let bindingsPath: string;
let mediaDir: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-dc-bridge-attach-'));
  sockPath = joinPath(tmp, 'elanous.sock');
  bindingsPath = joinPath(tmp, 'channel-bindings.json');
  mediaDir = joinPath(tmp, 'media');
  mkdirSync(mediaDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function captureRunTurn() {
  const captured: Array<{ promptBlocks: AcpContentBlock[] }> = [];
  const stub = async (turnCtx: {
    promptBlocks: AcpContentBlock[];
    push: (t: string) => Promise<void>;
  }): Promise<void> => {
    captured.push({ promptBlocks: turnCtx.promptBlocks });
    await turnCtx.push('ok');
  };
  return { captured, stub };
}

describe('discord bridge — attachments forward (Step 2 PR γ)', () => {
  test('image attachment: promptBlocks = [image, text+summary]', async () => {
    const { captured, stub } = captureRunTurn();
    const shutdownCtrl = new AbortController();
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stub },
    );
    await waitForSocket(sockPath);

    const photoPath = joinPath(mediaDir, 'p.jpg');
    writeFileSync(photoPath, Buffer.from([0xff, 0xd8, 0xff]));

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'snowflake-A',
      sessionId: 'sess-A',
      lastSeenMsgIdx: 0,
    });

    await bridge.runTurn({
      channelId: 'snowflake-A',
      userText: 'caption please',
      attachments: [{
        name: 'p.jpg', localPath: photoPath, mimeType: 'image/jpeg',
        kind: 'photo', width: 800, height: 600,
      }],
    });

    expect(captured).toHaveLength(1);
    const blocks = captured[0]!.promptBlocks;
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as { type: string }).type).toBe('image');
    expect((blocks[0] as { mimeType: string }).mimeType).toBe('image/jpeg');
    expect((blocks[1] as { text: string }).text).toContain('caption please');
    expect((blocks[1] as { text: string }).text).toMatch(/\[photo 800×600(?: · .*)?\]/);

    await bridge.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('document attachment: promptBlocks = [resource_link, text+summary]', async () => {
    const { captured, stub } = captureRunTurn();
    const shutdownCtrl = new AbortController();
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stub },
    );
    await waitForSocket(sockPath);

    const docPath = joinPath(mediaDir, 'spec.pdf');
    writeFileSync(docPath, 'fake pdf bytes');

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-B',
      sessionId: 'sess-B',
      lastSeenMsgIdx: 0,
    });

    await bridge.runTurn({
      channelId: 'chan-B',
      userText: 'summarize',
      attachments: [{
        name: 'spec.pdf', localPath: docPath, mimeType: 'application/pdf',
        kind: 'document', sizeBytes: 14,
      }],
    });

    const blocks = captured[0]!.promptBlocks;
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as { type: string }).type).toBe('resource_link');
    expect((blocks[0] as { name: string }).name).toBe('spec.pdf');
    expect((blocks[1] as { text: string }).text).toContain('summarize');
    expect((blocks[1] as { text: string }).text).toMatch(/\[document: spec\.pdf(?: · .*)?\]/);

    await bridge.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('text-only legacy turn: promptBlocks = [text] (parity with PR α)', async () => {
    const { captured, stub } = captureRunTurn();
    const shutdownCtrl = new AbortController();
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stub },
    );
    await waitForSocket(sockPath);

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'C', sessionId: 'sess-C', lastSeenMsgIdx: 0,
    });
    await bridge.runTurn({ channelId: 'C', userText: 'plain text' });

    expect(captured[0]!.promptBlocks).toEqual([
      { type: 'text', text: 'plain text' },
    ]);

    await bridge.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });
});
