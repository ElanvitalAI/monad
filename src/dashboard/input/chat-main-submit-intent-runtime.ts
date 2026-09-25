import { debug, withAmbientSessionScope } from '../../debug/log.js';
import {
  createTurnSubmitFromIntent,
  isPlainTurnSubmit,
  isStickyAcpTurnSubmit,
  type PlainTurnSubmit,
  type StickyAcpTurnSubmit,
  type TurnSubmit,
} from '../../input/turn-submit.js';

export interface DashboardChatMainSubmitIntentRuntimeDeps {
  submit: TurnSubmit;
  beforeExecute?: (submit: TurnSubmit) => void | Promise<void>;
  runStickyAcpDispatch: (submit: StickyAcpTurnSubmit) => Promise<void> | void;
  runPlainTurn: (submit: PlainTurnSubmit) => Promise<void>;
}

/**
 * PR-C alpha, slice 2:
 * submit-turn execution gets its own small seam before sticky ACP and
 * plain chat submit are folded into a fuller TurnSubmit core.
 */
export async function runDashboardChatMainSubmitIntent(
  deps: DashboardChatMainSubmitIntentRuntimeDeps,
): Promise<'sticky-acp' | 'plain'> {
  const run = async (): Promise<'sticky-acp' | 'plain'> => {
  if (deps.beforeExecute) {
    await deps.beforeExecute(deps.submit);
  }
  if (debug.enabled) {
    debug.log('input.submit', 'execute.begin', {
      targetKind: deps.submit.target.kind,
      sourceKind: deps.submit.source.kind,
      textBytes: Buffer.byteLength(deps.submit.text, 'utf8'),
      ...(deps.submit.target.kind === 'sticky-acp'
        ? { backend: deps.submit.target.backend }
        : {}),
    });
  }
  try {
    if (isStickyAcpTurnSubmit(deps.submit)) {
      await deps.runStickyAcpDispatch(deps.submit);
      if (debug.enabled) {
        debug.log('input.submit', 'execute.ok', {
          targetKind: deps.submit.target.kind,
          sourceKind: deps.submit.source.kind,
        });
      }
      return 'sticky-acp';
    }

    if (!isPlainTurnSubmit(deps.submit)) {
      throw new Error(`dashboard submit runtime expected plain submit, got ${deps.submit.target.kind}`);
    }
    await deps.runPlainTurn(deps.submit);
    if (debug.enabled) {
      debug.log('input.submit', 'execute.ok', {
        targetKind: deps.submit.target.kind,
        sourceKind: deps.submit.source.kind,
      });
    }
    return 'plain';
  } catch (error) {
    if (debug.enabled) {
      debug.log('input.submit', 'execute.error', {
        targetKind: deps.submit.target.kind,
        sourceKind: deps.submit.source.kind,
        error: error instanceof Error ? error.message : String(error),
      }, { level: 'error' });
    }
    throw error;
  }
  };
  return deps.submit.sessionId
    ? withAmbientSessionScope(deps.submit.sessionId, run)
    : run();
}

export function createDashboardChatMainTurnSubmit(
  intent: Parameters<typeof createTurnSubmitFromIntent>[0],
): TurnSubmit {
  return createTurnSubmitFromIntent(intent);
}
