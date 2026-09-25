import type { ControlSignalBus } from '../../input/control-signal.js';

export interface DashboardQuickPassConsumersDeps {
  signalBus: ControlSignalBus;
  cancelOutput: () => void | Promise<void>;
  onConsumed?: (signal: { kind: string; urgency: string; surface: string | null }) => void;
  onError?: (signal: { kind: string }, error: unknown) => void;
}

export function attachDashboardQuickPassConsumers(
  deps: DashboardQuickPassConsumersDeps,
): () => void {
  const stops: Array<() => void> = [];

  async function consume(signal: { kind: string; urgency: string; scope?: { surface?: string } }): Promise<void> {
    try {
      await deps.cancelOutput();
      deps.onConsumed?.({
        kind: signal.kind,
        urgency: signal.urgency,
        surface: signal.scope?.surface ?? null,
      });
    } catch (error) {
      deps.onError?.({ kind: signal.kind }, error);
    }
  }

  stops.push(deps.signalBus.subscribe(
    { minUrgency: 'quick-pass', surface: 'voice-chat' },
    (signal) => {
      if (signal.kind !== 'voice-chat-stop') return;
      void consume(signal);
    },
  ));
  stops.push(deps.signalBus.subscribe(
    { minUrgency: 'quick-pass', surface: 'chat-main' },
    (signal) => {
      if (signal.kind !== 'turn-submit-preempt-output') return;
      void consume(signal);
    },
  ));

  return () => {
    for (const stop of stops) stop();
  };
}
