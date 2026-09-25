import { debug } from '../debug/log.js';
import { findRecentQuickPassSignal } from './turn-submit-revision.js';
import type { ControlSignalBus, ControlSignalScope } from './control-signal.js';
import type { TurnOutputSinkKind } from './turn-output-sink-registry.js';

export type TurnOutputBundleSettleReason = 'end_turn' | 'error' | 'cancelled';

export interface TurnOutputBundleSink {
  readonly kind: TurnOutputSinkKind;
  readonly lifecycle?: string;
  readonly onEndTurn?: () => void | Promise<void>;
  readonly onCancel?: () => void | Promise<void>;
}

export interface TurnOutputBundle {
  readonly sinks: readonly TurnOutputBundleSink[];
  whenAllSettled(reason: TurnOutputBundleSettleReason): Promise<void>;
  cancelAll(): Promise<void>;
}

export interface TurnOutputBundleQuickPassGate {
  signalBus: ControlSignalBus;
  scope: ControlSignalScope;
  windowMs?: number;
  signalKinds?: readonly string[];
}

export interface RunTurnOutputBundleSettleDeps {
  bundle: TurnOutputBundle;
  settled: TurnOutputBundleSettleReason;
  cooldownMs: number;
  notifyDone?: (reason: TurnOutputBundleSettleReason) => void;
  debugPath: string;
  preSettleQuickPass?: TurnOutputBundleQuickPassGate;
}

export function createTurnOutputBundle(
  sinks: readonly TurnOutputBundleSink[],
): TurnOutputBundle {
  return {
    sinks,
    async whenAllSettled(reason) {
      for (const sink of sinks) {
        if (reason === 'end_turn') await sink.onEndTurn?.();
        else await sink.onCancel?.();
      }
    },
    async cancelAll() {
      for (const sink of sinks) {
        await sink.onCancel?.();
      }
    },
  };
}

export async function runTurnOutputBundleSettle(
  deps: RunTurnOutputBundleSettleDeps,
): Promise<TurnOutputBundleSettleReason> {
  let settleReason = deps.settled;
  if (settleReason === 'end_turn' && deps.preSettleQuickPass) {
    const signal = findRecentQuickPassSignal(deps.preSettleQuickPass);
    if (signal) {
      settleReason = 'cancelled';
      if (debug.enabled) {
        debug.log('input.control', 'pre-settle.preempt', {
          path: deps.debugPath,
          signalKind: signal.kind,
          signalId: signal.id,
        });
      }
    }
  }
  try {
    await deps.bundle.whenAllSettled(settleReason);
  } catch (err) {
    if (debug.enabled) {
      debug.log('turn.output', 'bundle.settle.exception', {
        path: deps.debugPath,
        reason: settleReason,
        err: err instanceof Error ? err.message : String(err),
      }, { level: 'error' });
    }
  }
  if (deps.cooldownMs > 0) {
    if (debug.enabled) {
      debug.log('voice.auto-tts', 'dispatch.drain.cooldown', {
        ms: deps.cooldownMs,
        path: deps.debugPath,
        reason: settleReason,
      });
    }
    await new Promise((r) => setTimeout(r, deps.cooldownMs));
  }
  try {
    deps.notifyDone?.(settleReason);
  } catch (e) {
    if (debug.enabled) {
      debug.log('turn.output', 'bundle.notify.exception', {
        path: deps.debugPath,
        err: e instanceof Error ? e.message : String(e),
      }, { level: 'error' });
    }
  }
  return settleReason;
}
