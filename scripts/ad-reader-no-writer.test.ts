import { describe, expect, test } from 'bun:test';
import { runAdReaderNoWriter, scanSources, selfCheck } from './ad-reader-no-writer.js';

const knownSources = [
  { path: 'src/ad-pipeline/reader.ts', test: false, text: 'result.collectGroundingFacts; result.collectGroundingFacts; result.negativePromptPresent; result.negativePromptPresent; result.safeAreaViolations; result.safeAreaViolations; const a = { copyProvenance, qc, detectedTextRegions, raw }; const b = { ...preset };' },
  { path: 'src/dashboard/index.ts', test: false, text: "import { reader } from '../ad-pipeline/reader.js'; const runtime = { collectGroundingFacts };" },
  { path: 'src/ad-pipeline/reader.test.ts', test: true, text: 'const fixture = { collectGroundingFacts: true, negativePromptPresent: true, safeAreaViolations: [], copyProvenance: {}, qc: {}, detectedTextRegions: [], raw: new Uint8Array() };' },
] as const;

describe('ad-reader-no-writer', () => {
  test('AST counts shorthand supply, ignores declarations, and reports blind spots including imported consumer files', () => {
    const report = scanSources([...knownSources, { path: 'src/ad-pipeline/types.ts', test: false, text: 'interface Result { declaredOnly?: boolean }' }]);
    expect(report.suspects).toEqual(['negativePromptPresent', 'safeAreaViolations']);
    expect(report.fields.get('collectGroundingFacts')?.productionSupplies).toBe(1);
    expect(report.fields.get('copyProvenance')?.productionSupplies).toBe(1);
    expect(report.fields.has('declaredOnly')).toBeFalse();
    expect(report.blindSpots).toEqual({ spreadSupplied: 1, consumerFiles: 1 });
  });

  test('one-hop relative .js import consumer supplies a scanned reader field but an unimported file does not', () => {
    const sources = [
      { path: 'src/ad-pipeline/reader.ts', test: false, text: 'deps.foo; deps.foo;' },
      { path: 'src/dashboard/index.ts', test: false, text: "import '../ad-pipeline/reader.js'; const runtime = { foo: true };" },
      { path: 'src/dashboard/ignored.ts', test: false, text: 'const runtime = { foo: true };' },
      { path: 'src/ad-pipeline/reader.test.ts', test: true, text: 'const fixture = { foo: true };' },
    ] as const;
    expect(scanSources(sources).suspects).not.toContain('foo');
    const withoutImport = sources.map(source => source.path === 'src/dashboard/index.ts' ? { ...source, text: 'const runtime = { foo: true };' } : source);
    expect(scanSources(withoutImport).suspects).toContain('foo');
  });

  test('consumer reads do not enter the reader population', () => {
    const report = scanSources([
      { path: 'src/ad-pipeline/reader.ts', test: false, text: 'const reader = true;' },
      { path: 'src/dashboard/index.ts', test: false, text: "import '../ad-pipeline/reader.js'; result.bar; result.bar;" },
    ]);
    expect(report.fields.get('bar')?.reads ?? 0).toBe(0);
    expect(report.blindSpots.consumerFiles).toBe(1);
  });

  test('self-check fails before reporting when a known supplied field becomes a false suspect', () => {
    const report = scanSources(knownSources.map(source => source.path === 'src/dashboard/index.ts' ? { ...source, text: "import { reader } from '../ad-pipeline/reader.js';" } : source));
    expect(selfCheck(report)).toContain('known production supplies missing: collectGroundingFacts');
    const errors: string[] = [];
    expect(runAdReaderNoWriter({ sources: reportSources(report), baseline: new Set(), error: line => errors.push(line) })).toBe(1);
    expect(errors[0]).toContain('SELF-CHECK FAIL');
  });

  test('new suspect names fail while an explicit baseline accepts them and --update snapshots them', () => {
    const sources = [...knownSources, { path: 'src/ad-pipeline/new.ts', test: false, text: 'result.newGap; result.newGap;' }, { path: 'src/ad-pipeline/new.test.ts', test: true, text: 'const fixture = { newGap: true };' }];
    const errors: string[] = [];
    expect(runAdReaderNoWriter({ sources, baseline: new Set(['negativePromptPresent', 'safeAreaViolations']), error: line => errors.push(line) })).toBe(1);
    expect(errors[0]).toContain('newGap');
    let updated: readonly string[] = [];
    expect(runAdReaderNoWriter({ args: ['--update'], sources, writeBaseline: names => { updated = names; } })).toBe(0);
    expect(updated).toContain('newGap');
  });
});

function reportSources(report: ReturnType<typeof scanSources>) {
  const supplied = [...report.fields.entries()].filter(([, value]) => value.productionSupplies > 0).map(([name]) => name);
  return [
    { path: 'src/ad-pipeline/reader.ts', test: false, text: 'result.collectGroundingFacts; result.collectGroundingFacts; result.negativePromptPresent; result.negativePromptPresent; result.safeAreaViolations; result.safeAreaViolations; const a = { ' + supplied.join(', ') + ' };' },
    { path: 'src/dashboard/index.ts', test: false, text: "import { reader } from '../ad-pipeline/reader.js'; const runtime = { " + supplied.join(', ') + ' };' },
    { path: 'src/ad-pipeline/reader.test.ts', test: true, text: 'const fixture = { collectGroundingFacts: true, negativePromptPresent: true, safeAreaViolations: [], copyProvenance: {} };' },
  ];
}
