import {
  measureScreenContrast,
  parseScreenRuns,
  type Rgb,
  type ScreenContrastReport,
} from './screen-contrast.js';

export interface RunScreenContrastOptions {
  readonly ansi: string;
  readonly background?: string;
  readonly foreground?: string;
  readonly threshold?: number;
}

export interface ScreenContrastRun {
  readonly report: ScreenContrastReport;
  readonly lines: readonly string[];
}

function parseColor(color: string | undefined, name: 'background' | 'foreground'): Rgb | null {
  if (color === undefined) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (match === null) throw new Error(`Invalid ${name} color: ${color}. Expected #rrggbb.`);
  const value = match[1]!;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

/** Parses an ANSI snapshot, delegates contrast judgment to the canonical calculator, and formats its verdict. */
export function runScreenContrast({ ansi, background, foreground, threshold }: RunScreenContrastOptions): ScreenContrastRun {
  const report = measureScreenContrast(
    parseScreenRuns(ansi),
    parseColor(background, 'background'),
    threshold,
    parseColor(foreground, 'foreground'),
  );
  const lines = [
    `measured: ${report.measured}`,
    `below-threshold: ${report.findings.length} (threshold ${report.threshold}:1)`,
    ...report.findings.map((finding) => `below-threshold: ${JSON.stringify(finding.text)} ${formatRatio(finding.ratio)}`),
    `decorative: ${report.decorative}`,
    `unresolved: ${report.unresolved}`,
  ];
  return { report, lines };
}
