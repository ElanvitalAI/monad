import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';

import { runAcpServer } from '../src/acp/server.js';
import type { NormalizedAttachment } from '../src/acp/content-blocks.js';
import { createInProcessAcpBridge } from '../src/tui-client/acp-transport-local.js';
import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from '../src/acp/transport/index.js';

interface Harness {
  conn: ClientSideConnection;
  shutdown(): Promise<void>;
}

async function bootHarness(opts: {
  runAgentTurn: NonNullable<Parameters<typeof runAcpServer>[0]>['runAgentTurn'];
}): Promise<Harness> {
  const bridge = createInProcessAcpBridge();
  const shutdownCtrl = new AbortController();
  let acpOnConnection: AcpConnectionHandler | null = null;
  const acpDone = runAcpServer({
    transportFactory: async (onConnection): Promise<AcpTransportServer> => {
      acpOnConnection = onConnection;
      return {
        kind: 'in-process' as const,
        address: 'repl-attachments://stub',
        close: async () => {
          try { await bridge.a.writable.close(); } catch { /* already */ }
          try { await bridge.b.writable.close(); } catch { /* already */ }
        },
      };
    },
    shutdownSignal: shutdownCtrl.signal,
    runAgentTurn: opts.runAgentTurn,
  });
  acpDone.catch(() => { /* aborted shutdown is expected */ });

  const stream = ndJsonStream(bridge.b.writable, bridge.b.readable);
  const conn = new ClientSideConnection(() => ({
    async requestPermission() {
      return { outcome: { outcome: 'cancelled' as const } };
    },
  }), stream);

  const transportConn: AcpTransportConnection = {
    readable: bridge.a.readable,
    writable: bridge.a.writable,
    peerId: 'repl-attachments-peer',
    close: async () => {
      try { await bridge.a.writable.close(); } catch { /* already */ }
    },
  };
  Promise.resolve(acpOnConnection?.(transportConn)).catch(() => { /* shutdown */ });

  return {
    conn,
    async shutdown() {
      shutdownCtrl.abort();
      try { await bridge.b.writable.close(); } catch { /* already */ }
      try { await acpDone; } catch { /* aborted */ }
    },
  };
}

let harness: Harness | null = null;

beforeEach(() => {
  harness = null;
});

afterEach(async () => {
  if (harness) {
    await harness.shutdown();
    harness = null;
  }
});

describe('ACP terminal/repl/exec attachments', () => {
  test('normalizes image/audio/video attachments and drops pathless entries', async () => {
    let captured: NormalizedAttachment[] | undefined;
    harness = await bootHarness({
      runAgentTurn: async (input) => {
        captured = input.attachments;
        return {
          sessionId: input.sessionId,
          markdown: 'ok',
          modelLabel: 'test/model',
          stopReason: 'end_turn',
          contextLines: 0,
        };
      },
    });

    await harness.conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    const { sessionId } = await harness.conn.newSession({ cwd: process.cwd(), mcpServers: [] });

    const res = await harness.conn.extMethod('terminal/repl/exec', {
      sessionId,
      terminalId: 'tid-test',
      line: ':agent inspect attachments',
      attachments: [
        { path: '/tmp/shot.png', filename: 'shot.png', mediaType: 'image/png', size: 12 },
        { path: '/tmp/note.wav', filename: 'note.wav', mediaType: 'audio/wav' },
        { path: '/tmp/clip.mp4', filename: 'clip.mp4', mediaType: 'video/mp4' },
        { filename: 'missing-path.png', mediaType: 'image/png' },
      ],
    }) as {
      agent?: { markdown: string };
    };

    expect(res.agent?.markdown).toBe('ok');
    expect(captured).toEqual([
      {
        name: 'shot.png',
        localPath: '/tmp/shot.png',
        kind: 'photo',
        mimeType: 'image/png',
        sizeBytes: 12,
      },
      {
        name: 'note.wav',
        localPath: '/tmp/note.wav',
        kind: 'audio',
        mimeType: 'audio/wav',
      },
      {
        name: 'clip.mp4',
        localPath: '/tmp/clip.mp4',
        kind: 'document',
        mimeType: 'video/mp4',
      },
    ]);
  });
});
