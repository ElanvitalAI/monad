import { debug, withAmbientSessionScope } from '../debug/log.js';
import type { NormalizedAttachment } from '../acp/content-blocks.js';
import type { DashboardSendResult, DashboardSession } from './dashboard-session.js';
import {
  createTurnSubmitFromIntent,
  isDaemonSessionTurnSubmit,
  type DaemonSessionTurnSubmit,
  type TurnSubmit,
} from '../input/turn-submit.js';
import { writeInputSourceMeta } from '../acp/input-source-meta.js';

export interface DaemonSessionSubmitRuntimeDeps {
  submit: TurnSubmit;
  session: DashboardSession;
  beforeExecute?: (submit: DaemonSessionTurnSubmit) => void | Promise<void>;
  attachments?: NormalizedAttachment[];
  onText?: (chunk: string) => void;
}

export async function runDaemonSessionTurnSubmit(
  deps: DaemonSessionSubmitRuntimeDeps,
): Promise<DashboardSendResult> {
  return withAmbientSessionScope(deps.session.id, async () => {
  if (!isDaemonSessionTurnSubmit(deps.submit)) {
    if (debug.enabled) {
      debug.log('input.submit', 'daemon-session.error', {
        targetKind: deps.submit.target.kind,
        sourceKind: deps.submit.source.kind,
        reason: 'wrong-target',
      }, { level: 'error' });
    }
    throw new Error(`daemon session runtime requires daemon-session submit, got ${deps.submit.target.kind}`);
  }
  if (debug.enabled) {
    debug.log('input.submit', 'daemon-session.begin', {
      sourceKind: deps.submit.source.kind,
      textBytes: Buffer.byteLength(deps.submit.text, 'utf8'),
      attachmentCount: deps.attachments?.length ?? 0,
    });
  }
  try {
    if (deps.beforeExecute) {
      await deps.beforeExecute(deps.submit);
    }
    const result = await deps.session.send({
      userText: deps.submit.text,
      meta: writeInputSourceMeta(deps.submit.source),
      ...(deps.attachments && deps.attachments.length > 0
        ? { attachments: deps.attachments }
        : {}),
      ...(deps.onText ? { onText: deps.onText } : {}),
    });
    if (debug.enabled) {
      debug.log('input.submit', 'daemon-session.ok', {
        sourceKind: deps.submit.source.kind,
        attachmentCount: deps.attachments?.length ?? 0,
      });
    }
    return result;
  } catch (error) {
    if (debug.enabled) {
      debug.log('input.submit', 'daemon-session.error', {
        sourceKind: deps.submit.source.kind,
        attachmentCount: deps.attachments?.length ?? 0,
        error: error instanceof Error ? error.message : String(error),
      }, { level: 'error' });
    }
    throw error;
  }
  });
}

export function createDaemonSessionTurnSubmit(
  intent: Parameters<typeof createTurnSubmitFromIntent>[0],
): TurnSubmit {
  return createTurnSubmitFromIntent(intent);
}
