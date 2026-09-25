import { debug } from '../debug/log.js';
import {
  createTurnSubmitFromIntent,
  isDaemonPromptTurnSubmit,
  type DaemonPromptTurnSubmit,
  type TurnSubmit,
} from '../input/turn-submit.js';
import type { DaemonPromptTurnResult } from './daemon-prompt-turn.js';

export interface DaemonPromptSubmitRuntimeDeps {
  submit: TurnSubmit;
  beforeExecute?: (submit: DaemonPromptTurnSubmit) => void | Promise<void>;
  runDaemonPrompt: (submit: DaemonPromptTurnSubmit) => Promise<DaemonPromptTurnResult>;
}

export async function runDaemonPromptSubmit(
  deps: DaemonPromptSubmitRuntimeDeps,
): Promise<DaemonPromptTurnResult> {
  if (!isDaemonPromptTurnSubmit(deps.submit)) {
    if (debug.enabled) {
      debug.log('input.submit', 'daemon-prompt.error', {
        targetKind: deps.submit.target.kind,
        sourceKind: deps.submit.source.kind,
        reason: 'wrong-target',
      }, { level: 'error' });
    }
    throw new Error(`daemon prompt runtime requires daemon-prompt submit, got ${deps.submit.target.kind}`);
  }
  if (debug.enabled) {
    debug.log('input.submit', 'daemon-prompt.begin', {
      sourceKind: deps.submit.source.kind,
      textBytes: Buffer.byteLength(deps.submit.text, 'utf8'),
    });
  }
  try {
    if (deps.beforeExecute) {
      await deps.beforeExecute(deps.submit);
    }
    const result = await deps.runDaemonPrompt(deps.submit);
    if (debug.enabled) {
      debug.log('input.submit', 'daemon-prompt.ok', {
        sourceKind: deps.submit.source.kind,
        stopReason: result.stopReason,
        responseBytes: Buffer.byteLength(result.text, 'utf8'),
      });
    }
    return result;
  } catch (error) {
    if (debug.enabled) {
      debug.log('input.submit', 'daemon-prompt.error', {
        sourceKind: deps.submit.source.kind,
        error: error instanceof Error ? error.message : String(error),
      }, { level: 'error' });
    }
    throw error;
  }
}

export function createDaemonPromptTurnSubmit(
  intent: Parameters<typeof createTurnSubmitFromIntent>[0],
): TurnSubmit {
  return createTurnSubmitFromIntent(intent);
}
