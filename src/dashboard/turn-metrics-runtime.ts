import type { ChatMessage } from '../chat/index.js';
import type { LLMUsage } from '../prompt-cache/types.js';
import { recordLlmUsage } from '../context-display/index.js';
import { debug } from '../debug/log.js';

export interface DashboardTurnUsageRuntimeDeps {
  usage: LLMUsage;
  importPromptCache: () => Promise<{
    formatUsageLine: (usage: LLMUsage) => string;
    recordUsage: (usage: LLMUsage) => void;
  }>;
  pushDebugLine: (line: string) => void;
  muted: (text: string) => string;
  draw: () => void;
  /** Active model id for context-display telemetry. When omitted, the
   *  telemetry record falls back to the provider name as the model
   *  label (display-only — cost rollups still use cost-meter). */
  activeModelId?: string;
}

export interface DashboardTurnMetricsRuntimeDeps {
  chatHistory: ChatMessage[];
  model: string;
  fullResponse: string;
  turnStartedAt: number;
  usage?: Pick<LLMUsage, 'inputTokens' | 'outputTokens' | 'cacheReadInputTokens'>;
  importStatusMetrics: () => Promise<{
    recordTurn: (input: {
      model: string;
      usage?: {
        inputTokens: number;
        outputTokens?: number;
        cacheReadTokens?: number;
      };
      estimatedPromptText?: string;
      estimatedOutputText?: string;
      seconds: number;
    }) => unknown;
  }>;
}

export function runDashboardTurnUsageRuntime(
  deps: DashboardTurnUsageRuntimeDeps,
): void {
  // Wave 1 (2026-05-04) · /context telemetry capture. Persistent
  // cost rollups still go through `recordUsage` below; this records
  // the same call into the in-memory ring buffer that backs
  // `/context`, `/usage`, and (Wave 5) auto-compact gating. Best-
  // effort: never block the chat loop on telemetry I/O.
  try {
    const provider = deps.usage.provider ?? 'unknown';
    recordLlmUsage({
      provider,
      model: deps.activeModelId ?? provider,
      usage: deps.usage,
    });
  } catch { /* swallow — Persistence/IO errors on hot paths */ }
  deps.importPromptCache()
    .then(({ formatUsageLine, recordUsage }) => {
      recordUsage(deps.usage);
      deps.pushDebugLine(deps.muted(`  ${formatUsageLine(deps.usage)}`));
      deps.draw();
    })
    .catch(() => { /* best-effort telemetry */ });
}

export async function recordDashboardTurnMetrics(
  deps: DashboardTurnMetricsRuntimeDeps,
): Promise<void> {
  const { recordTurn } = await deps.importStatusMetrics();
  const prompt = deps.chatHistory
    .slice(-2)
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('\n');
  const turnSec = Math.max(0.1, (Date.now() - deps.turnStartedAt) / 1000);
  const inputTokens = deps.usage?.inputTokens;
  if (typeof inputTokens === 'number') {
    recordTurn({
      model: deps.model,
      usage: {
        inputTokens,
        ...(deps.usage?.outputTokens !== undefined ? { outputTokens: deps.usage.outputTokens } : {}),
        ...(deps.usage?.cacheReadInputTokens !== undefined
          ? { cacheReadTokens: deps.usage.cacheReadInputTokens }
          : {}),
      },
      seconds: turnSec,
    });
    debug.log('dashboard.turn-metrics', 'context-source', {
      source: 'provider-usage',
      inputTokens,
    });
    return;
  }

  recordTurn({
    model: deps.model,
    estimatedPromptText: prompt,
    estimatedOutputText: deps.fullResponse,
    seconds: turnSec,
  });
  debug.log('dashboard.turn-metrics', 'context-source', {
    source: 'estimate',
    inputTokens,
  });
}
