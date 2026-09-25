import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;
type ReadMorningVerdict = () => string;
type ParsedMorningVerdict = ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };

/** Morning-verdict's ready, degraded, and unmeasurable symbols. */
export const trafficlightVocabulary = ['✅', '⛔', '⚪'] as const;

const morningVerdictPath = resolve(import.meta.dir, '../../../scripts/botlab/morning-verdict.ts');

function readMorningVerdict(): string {
  return readFileSync(morningVerdictPath, 'utf8');
}

function renderedTrafficlightSymbols(source: string): Set<string> | null {
  const parsed = ts.createSourceFile('morning-verdict.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS) as ParsedMorningVerdict;
  if (parsed.parseDiagnostics.length > 0) return null;

  const symbols = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'say') {
      const renderedArguments = node.arguments.map(argument => argument.getText(parsed)).join(' ');
      for (const symbol of trafficlightVocabulary) {
        if (renderedArguments.includes(symbol)) symbols.add(symbol);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return symbols;
}

function degradedTrafficlight(reason: string): ProbeResult {
  return {
    ok: false,
    reason,
    repairHint: {
      paths: ['scripts/botlab/morning-verdict.ts'],
      what: 'Restore the ready, degraded, and unmeasurable traffic-light symbols to morning-verdict rendering.',
    },
  };
}

export function probeTrafficlight(readSource: ReadMorningVerdict = readMorningVerdict): ProbeResult {
  try {
    const renderedSymbols = renderedTrafficlightSymbols(readSource());
    if (renderedSymbols === null) return degradedTrafficlight('Morning-verdict traffic-light rendering could not be parsed.');
    if (trafficlightVocabulary.every(symbol => renderedSymbols.has(symbol))) return { ok: true };
    return degradedTrafficlight('Morning-verdict traffic-light rendering vocabulary is incomplete.');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return degradedTrafficlight(`Morning-verdict traffic-light rendering could not be read: ${detail}`);
  }
}

export function createTrafficlightProvider(readSource: ReadMorningVerdict = readMorningVerdict): CapabilityProvider {
  return {
    id: 'report.trafficlight',
    async probe(): Promise<ProbeResult> {
      return probeTrafficlight(readSource);
    },
  };
}

export default createTrafficlightProvider();
