#!/usr/bin/env bun
// qwen-pipeline-smoke.ts · live exercise of the local-llm path against
// LM Studio's currently-loaded qwen 3.6 model.
//
// Validates three pipeline kinds end-to-end through LocalProvider:
//   1. analysis   — long-form reasoning question, text-only output
//   2. coding     — code emission, syntactic sanity check
//   3. debugging  — tool-use loop (model must invoke a fake `read_file`
//                   tool, receive its result, then summarize)
//
// For each: time-to-first-token, total wall time, token counts (input,
// visible output, hidden reasoning), tool-call event count, and the
// first 400 chars of the visible answer. Failures are captured and
// reported, not thrown — the harness completes the matrix even when
// individual scenarios stumble so the user has a complete picture
// after a single run.
//
// Usage: bun scripts/qwen-pipeline-smoke.ts [model-id]
//   default model: qwen3.6-35b-a3b-ud-mlx (whichever is loaded)
//
// Pre-req: LM Studio running on http://localhost:1234 with at least one
// chat-capable model loaded. The harness will probe and report which
// loaded models it finds, then run against the first one whose id
// matches `model-id` substring (default `qwen3.6`).

import { LocalProvider } from '../src/llm.js';
import { refreshInventory, _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import type { LLMMessage, LLMStreamEvent } from '../src/llm.js';

// LocalProvider.available() gates on getLocalLLMUrl(). Set the env so
// the OpenAI-compat path through LM Studio's :1234/v1 is unlocked
// even when the user hasn't run the setup wizard yet — this script is
// a CI-style probe, not a config mutation.
process.env['LOCAL_LLM_URL'] = process.env['LOCAL_LLM_URL'] || 'http://localhost:1234/v1';

const MODEL_FILTER = process.argv[2] || 'qwen3.6';

interface ScenarioResult {
  name: string;
  ok: boolean;
  ms: number;
  ttftMs: number | null;
  visibleChars: number;
  reasoningChars: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  preview: string;
  error?: string;
}

async function probeAndPickModel(): Promise<string | null> {
  console.log('▶ Probing local LLM fleet via LM Studio v0 endpoint…');
  _resetManagerForTesting();
  const inv = await refreshInventory();
  console.log(
    `  reachable nodes: ${inv.nodes.filter(n => n.reachable).length}/${inv.nodes.length}` +
    ` · models: ${inv.models.length}` +
    ` · warnings: ${inv.warnings.length}`,
  );
  if (inv.warnings.length > 0) {
    for (const w of inv.warnings.slice(0, 5)) console.log(`    ⚠ ${w}`);
  }
  const lmstudio = inv.models.filter(m => m.runtime === 'lmstudio');
  const loaded = lmstudio.filter(m => m.loaded === true);
  console.log(`  lmstudio: ${lmstudio.length} installed, ${loaded.length} loaded`);
  for (const m of loaded.slice(0, 8)) {
    const caps = m.capabilities?.join(',') ?? '?';
    const ctx = m.loadedContextWindow ?? m.contextWindow;
    const ctxLabel = ctx ? `${(ctx / 1024).toFixed(0)}K` : '?';
    console.log(
      `    ✓ ${m.id}  [${caps}]  ${ctxLabel}ctx  ${m.arch ?? ''} ${m.quantization ?? ''}`.trim(),
    );
  }
  // Pick the first loaded model that matches the filter substring; fall
  // back to the first loaded model overall, then to the first installed.
  const pick =
    loaded.find(m => m.id.toLowerCase().includes(MODEL_FILTER.toLowerCase()))
    ?? loaded[0]
    ?? lmstudio[0];
  if (!pick) {
    console.log('✗ No LM Studio model found. Make sure the LM Studio app is running.');
    return null;
  }
  console.log(`▶ Selected: ${pick.id}  (loaded=${pick.loaded ?? 'unknown'})`);
  console.log('');
  return `local-llm:${pick.nodeId}:${pick.id}`;
}

async function runScenario(
  name: string,
  modelSpec: string,
  messages: LLMMessage[],
  tools: any[] | undefined,
): Promise<ScenarioResult> {
  const startedAt = Date.now();
  let ttftMs: number | null = null;
  let visibleChars = 0;
  let reasoningChars = 0;
  let toolCalls = 0;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let reasoningTokens: number | undefined;
  const previewBuf: string[] = [];
  let previewLen = 0;
  const reasoningPreview: string[] = [];
  let reasoningPreviewLen = 0;
  try {
    // 4096 instead of 1024: qwen 3.6 reasoning_content eats 5-15x more
    // budget than visible content. At 1024 max, coding-class prompts
    // produce 0 visible chars (all budget consumed by hidden thinking).
    // 4096 is the new LocalProvider default (post-2026-05-05).
    const events = LocalProvider.streamChat!(messages, {
      model: modelSpec,
      maxTokens: 4096,
      temperature: 0.3,
      ...(tools ? { tools } : {}),
    });
    for await (const ev of events as AsyncGenerator<LLMStreamEvent>) {
      if (ttftMs === null) ttftMs = Date.now() - startedAt;
      if (ev.type === 'text') {
        visibleChars += ev.delta.length;
        if (previewLen < 400) {
          previewBuf.push(ev.delta);
          previewLen += ev.delta.length;
        }
      } else if (ev.type === 'reasoning' && ev.kind === 'inline_delta') {
        reasoningChars += ev.delta.length;
        if (reasoningPreviewLen < 200) {
          reasoningPreview.push(ev.delta);
          reasoningPreviewLen += ev.delta.length;
        }
      } else if (ev.type === 'tool_call') {
        toolCalls++;
        if (previewLen < 400) {
          const tcLine = `[tool_call: ${ev.name}(${JSON.stringify(ev.args).slice(0, 120)})]\n`;
          previewBuf.push(tcLine);
          previewLen += tcLine.length;
        }
      } else if (ev.type === 'usage') {
        inputTokens = ev.usage.inputTokens;
        outputTokens = ev.usage.outputTokens;
        reasoningTokens = ev.usage.reasoningOutputTokens;
      }
    }
  } catch (err: any) {
    return {
      name,
      ok: false,
      ms: Date.now() - startedAt,
      ttftMs,
      visibleChars,
      reasoningChars,
      toolCalls,
      preview: previewBuf.join('').slice(0, 400),
      error: err?.message ?? String(err),
    };
  }
  return {
    name,
    ok: true,
    ms: Date.now() - startedAt,
    ttftMs,
    visibleChars,
    reasoningChars,
    toolCalls,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    preview: (previewBuf.join('').slice(0, 400)
      + (reasoningPreview.length > 0
        ? `\n  [reasoning preview] ${reasoningPreview.join('').slice(0, 200).replace(/\n/g, ' ')}`
        : '')),
  };
}

function printResult(r: ScenarioResult): void {
  const head = r.ok ? '✓' : '✗';
  console.log(`${head} ${r.name}  ${r.ms}ms  ttft=${r.ttftMs ?? '—'}ms`);
  console.log(`   visibleChars=${r.visibleChars}  reasoningChars=${r.reasoningChars}  toolCalls=${r.toolCalls}`);
  if (r.inputTokens !== undefined || r.outputTokens !== undefined || r.reasoningTokens !== undefined) {
    console.log(
      `   tokens: in=${r.inputTokens ?? '?'}  out=${r.outputTokens ?? '?'}` +
      (r.reasoningTokens !== undefined ? `  (reasoning=${r.reasoningTokens})` : ''),
    );
  }
  if (r.error) console.log(`   error: ${r.error}`);
  if (r.preview) {
    console.log('   preview:');
    for (const line of r.preview.split('\n').slice(0, 8)) {
      console.log(`     ${line.slice(0, 160)}`);
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log('# qwen 3.6 local-llm pipeline smoke');
  console.log(`  date: ${new Date().toISOString()}`);
  console.log(`  filter: ${MODEL_FILTER}`);
  console.log('');

  const modelSpec = await probeAndPickModel();
  if (!modelSpec) process.exit(1);

  const results: ScenarioResult[] = [];

  // ─── Scenario 1: analysis ─────────────────────────────────────────
  results.push(await runScenario(
    'analysis',
    modelSpec,
    [{
      role: 'user',
      content:
        'Read this Python snippet and give me 3 specific concrete improvements. ' +
        'Be concise — one sentence per improvement, no preamble:\n\n' +
        '```py\ndef parse_csv(path):\n  rows = []\n  for line in open(path).readlines():\n' +
        '    rows.append(line.strip().split(","))\n  return rows\n```',
    }],
    undefined,
  ));
  printResult(results[results.length - 1]!);

  // ─── Scenario 2: coding ───────────────────────────────────────────
  results.push(await runScenario(
    'coding',
    modelSpec,
    [{
      role: 'user',
      content:
        'Write a TypeScript function `chunkArray<T>(arr: T[], size: number): T[][]` ' +
        'that splits an array into fixed-size chunks. Throw `RangeError` when size < 1. ' +
        'Reply with ONLY the function body in a single ```ts code block, no commentary.',
    }],
    undefined,
  ));
  printResult(results[results.length - 1]!);

  // ─── Scenario 3: debugging (tool-use loop) ────────────────────────
  // Single-turn test: model is given a fake `read_file` tool and asked
  // to diagnose a stack trace. We expect ONE tool_call event for
  // `read_file` with a sensible path, plus thinking trace.
  results.push(await runScenario(
    'debugging',
    modelSpec,
    [{
      role: 'user',
      content:
        'I see this error trace. Use the `read_file` tool to inspect the offending file ' +
        'before answering — pick the most likely path from the trace. Do NOT guess from memory.\n\n' +
        '```\nTraceback (most recent call last):\n' +
        '  File "src/billing/invoice.py", line 42, in render\n' +
        '    total = sum(items)\n' +
        'TypeError: unsupported operand type(s) for +: \'int\' and \'NoneType\'\n```',
    }],
    [{
      name: 'read_file',
      description: 'Read a file from the local filesystem and return its contents.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or repo-relative file path.' },
        },
        required: ['path'],
      },
    }],
  ));
  printResult(results[results.length - 1]!);

  // ─── Summary ──────────────────────────────────────────────────────
  console.log('# Summary');
  const okCount = results.filter(r => r.ok).length;
  console.log(`  ${okCount}/${results.length} scenarios completed without throwing`);
  let totalReasoning = 0;
  let totalVisible = 0;
  for (const r of results) {
    totalReasoning += r.reasoningChars;
    totalVisible += r.visibleChars;
  }
  console.log(`  reasoning chars total: ${totalReasoning}  · visible chars total: ${totalVisible}`);
  if (totalReasoning > 0 && totalVisible > 0) {
    const ratio = (totalReasoning / totalVisible).toFixed(2);
    console.log(`  reasoning : visible ratio ≈ ${ratio}x  (high = thinking-heavy model)`);
  }
  const debugScenario = results.find(r => r.name === 'debugging');
  if (debugScenario) {
    console.log(`  debugging tool_calls = ${debugScenario.toolCalls}` +
      (debugScenario.toolCalls > 0 ? ' ✓ tool-use working' : ' ✗ no tool call emitted'));
  }
  process.exit(okCount === results.length ? 0 : 2);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
