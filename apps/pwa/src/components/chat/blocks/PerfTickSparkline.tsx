// Opportunistic followup §6.2 #6 (2026-05-13) — `perf.tick` renderer.
//
// SVG sparkline showing rolling LLM-economy metrics. One inline line
// per metric name (currently shipped: `llm.tokens-per-sec` from the
// daemon's PerfTicker, plus any metric the LLM adapter or tool-runtime
// ticks via `perfTicker.tick(metric, value)`). The 60-sample cap on
// the accumulator (`PERF_SESSION_SAMPLE_CAP`) keeps the render set
// small enough for inline display next to ToolPills / ChatBubbles.

'use client';

import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'perf_session' }>;
type Sample = Block['samples'][number];

interface MetricGroup {
  metric: string;
  unit?: string;
  samples: Sample[];
  latest: number;
  min: number;
  max: number;
}

function groupByMetric(samples: readonly Sample[]): MetricGroup[] {
  const grouped = new Map<string, Sample[]>();
  for (const s of samples) {
    const arr = grouped.get(s.metric);
    if (arr) arr.push(s);
    else grouped.set(s.metric, [s]);
  }
  const out: MetricGroup[] = [];
  for (const [metric, samples] of grouped.entries()) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const s of samples) {
      if (s.value < min) min = s.value;
      if (s.value > max) max = s.value;
    }
    const latest = samples[samples.length - 1]!.value;
    const group: MetricGroup = {
      metric,
      samples,
      latest,
      min,
      max,
    };
    const unit = samples[samples.length - 1]!.unit;
    if (unit !== undefined) group.unit = unit;
    out.push(group);
  }
  // Sort: longest history first (likely most stable metric like
  // `llm.tokens-per-sec`) → cost / latency follow.
  out.sort((a, b) => b.samples.length - a.samples.length);
  return out;
}

const SPARKLINE_WIDTH = 80;
const SPARKLINE_HEIGHT = 18;

function buildPath(group: MetricGroup): string {
  if (group.samples.length === 0) return '';
  if (group.samples.length === 1) {
    return `M0,${SPARKLINE_HEIGHT / 2} L${SPARKLINE_WIDTH},${SPARKLINE_HEIGHT / 2}`;
  }
  const range = group.max - group.min || 1;
  const points = group.samples.map((s, idx) => {
    const x = (idx / (group.samples.length - 1)) * SPARKLINE_WIDTH;
    const norm = (s.value - group.min) / range;
    // Invert Y — SVG origin is top-left but visual "high value" should
    // be near the top of the cell.
    const y = SPARKLINE_HEIGHT - norm * SPARKLINE_HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${points[0]} L${points.slice(1).join(' L')}`;
}

function formatValue(value: number): string {
  if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

function MetricRow({ group }: { group: MetricGroup }) {
  const path = buildPath(group);
  return (
    <div
      data-elanous-perf-metric={group.metric}
      data-elanous-perf-latest={group.latest}
      className="flex items-center gap-2 text-[10px] font-mono"
    >
      <span className="text-muted-foreground truncate min-w-[120px]">
        {group.metric}
      </span>
      <svg
        width={SPARKLINE_WIDTH}
        height={SPARKLINE_HEIGHT}
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        className="shrink-0"
        aria-label={`${group.metric} sparkline`}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-amber-400"
        />
      </svg>
      <span className="text-foreground tabular-nums">
        {formatValue(group.latest)}
      </span>
      {group.unit && (
        <span className="text-muted-foreground">{group.unit}</span>
      )}
    </div>
  );
}

export function PerfTickSparkline({ block }: { block: Block }) {
  const groups = useMemo(() => groupByMetric(block.samples), [block.samples]);
  if (groups.length === 0) {
    return (
      <div
        data-elanous-block-kind="perf_session"
        data-elanous-block-id={block.blockId}
        className="rounded border border-border bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground italic"
      >
        (no perf samples yet)
      </div>
    );
  }
  return (
    <div
      data-elanous-block-kind="perf_session"
      data-elanous-block-id={block.blockId}
      data-elanous-perf-metric-count={groups.length}
      className={cn(
        'rounded border border-border bg-muted/20 px-2 py-1',
        'flex flex-col gap-0.5',
      )}
    >
      {groups.map((g) => (
        <MetricRow key={g.metric} group={g} />
      ))}
    </div>
  );
}
