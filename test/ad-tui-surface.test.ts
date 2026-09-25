import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildAdRunSetup } from '../src/ad-pipeline/ad-run-setup.js';
import type { CommandRunner } from '../src/ad-pipeline/higgsfield-backend.js';
import { createDashboardAdSlashRuntime, reportAdQc } from '../src/dashboard/ad-slash-runtime.js';
import { dispatchDashboardAdSlash } from '../src/dashboard/index.js';

const measuredContracts = readFileSync(new URL('../docs/ad-presets/higgsfield-measured-contracts.json', import.meta.url), 'utf8');

afterEach(() => { mock.restore(); });

describe('dashboard /ad slash runtime', () => {
  test('rejects invalid input before invoking the pipeline', async () => {
    const lines: string[] = [];
    let approvals = 0;
    const runtime = createDashboardAdSlashRuntime({
      approve: () => { approvals++; return true; },
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
    });

    await runtime.run([]);

    expect(approvals).toBe(0);
    expect(lines).toEqual(['  Cannot run /ad: No advertising input was provided.']);
  });

  test('accepts one valid --mode, removes it from intake, and rejects invalid mode options before pipeline execution', async () => {
    const lines: string[] = [];
    const spending: boolean[] = [];
    let approvals = 0;
    const modes: string[] = [];
    const runtime = createDashboardAdSlashRuntime({
      approve: (_gate, plan) => { approvals++; modes.push(plan.mode); return true; },
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: (allowSpend) => { spending.push(allowSpend); return undefined; },
    });

    await runtime.run(['Summer launch', '--mode', 'quality']);
    const approvedForValidMode = approvals;
    await runtime.run(['Summer launch', '--mode']);
    await runtime.run(['Summer launch', '--mode', 'slow']);
    await runtime.run(['Summer launch', '--mode', 'quick', '--mode', 'quality']);

    expect(modes).toContain('quality');
    expect(lines.slice(-3)).toEqual([
      '  Cannot run /ad: --mode must be one of quick, medium, quality.',
      '  Cannot run /ad: --mode must be one of quick, medium, quality.',
      '  Cannot run /ad: --mode must be one of quick, medium, quality.',
    ]);
    expect(approvals).toBe(approvedForValidMode);
    expect(spending).toEqual([false]);
  });

  test('reports caller-supplied missing production inputs before approval and production execution', async () => {
    const lines: string[] = [];
    const events: string[] = [];
    const missingProductionInputs = [
      'assembly', 'assemblyMaterials', 'captionFontPath', 'musicBedPath', 'qcThresholds',
      'voiceover', 'soundtrack', 'referenceAssets', 'shootRunOptions', 'ground', 'invariants',
    ];
    const runtime = createDashboardAdSlashRuntime({
      approve: (gate) => { events.push(`approve:${gate}`); return true; },
      report: (line) => { lines.push(line); if (line.startsWith('  ⚠️ /ad:')) events.push('warning'); },
      muted: (text) => text,
      warning: (text) => text,
      missingProductionInputs,
      production: {
        assembly: {
          clips: [{ beatIndex: 0, path: '/source/0.mp4', probe: { width: 1080, height: 1920, fps: '30/1', codec: 'h264', hasAudio: false } }],
          options: { workDir: '/work', outputName: 'master.mp4' },
          scene: {
            beats: [{ role: 'hook', startSec: 0, endSec: 2, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'campaign', checks: [] }],
            axes: { hook: 'campaign', totalSeconds: 2, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
            aspectRatio: '9:16',
            forbidden: [],
            provenance: 'generated',
          },
        },
        render: { run: async () => { events.push('production:render'); return { stdout: '', stderr: '', exitCode: 0 }; } },
      },
    });

    await runtime.run(['Summer launch campaign']);

    expect(lines[0]).toBe(
      `  ⚠️ /ad: this run cannot produce a master — 11 missing inputs: ${missingProductionInputs.join(', ')}`,
    );
    expect(events.slice(0, 5)).toEqual([
      'warning',
      'approve:BRIEF_OK',
      'approve:MASTER_PICK',
      'approve:PACK_OK',
      'approve:VIDEO_OK',
    ]);
    expect(events.slice(5)).toContain('production:render');
    expect(lines).toContain('  /ad production completed: /work/master.mp4');
    expect(lines).toContain('  /ad QC verdict: unmeasured  (기계: unmeasured · 사람 대기: 4축)');
  });

  test('uses the factory-built Higgsfield spending policy for each invocation and keeps spending closed by default', async () => {
    const lines: string[] = [];
    const selected: boolean[] = [];
    const commands: (readonly string[])[] = [];
    const runner: CommandRunner = {
      async run(argv) {
        commands.push(argv);
        return { stdout: '32dc92c9-3d64-4b55-92c4-c9551f8f5844', stderr: '', exitCode: 0 };
      },
    };
    const runtime = createDashboardAdSlashRuntime({
      approve: () => true,
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: (allowSpend) => {
        selected.push(allowSpend);
        const setup = buildAdRunSetup({
          home: '/tmp', slug: 'summer-launch', date: '2026-09-12', version: 1, aspect: '9x16',
          contractsJson: measuredContracts, runner, allowSpend, higgsfieldCliPath: 'hf',
          assembly: {
            scene: {
              beats: [{ role: 'hook', startSec: 0, endSec: 4, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'seedance_2_0', audio: false, promptCore: 'summer launch', checks: [] }],
              axes: { hook: 'summer launch', totalSeconds: 4, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
              aspectRatio: '9:16', forbidden: [], provenance: 'generated',
            },
          },
          referenceAssets: { seedance_2_0: [] },
          shootRunOptions: { submitRetries: 0, maxPollsPerJob: 1 },
        });
        if ('error' in setup || !setup.production) throw new Error('expected factory production');
        return setup.production;
      },
    });

    const spendCommands = () => commands.filter((argv) => argv.includes('generate') && argv.includes('create'));
    await runtime.run(['Summer launch campaign']);
    expect(spendCommands()).toEqual([]);
    await runtime.run(['Summer launch campaign', '--spend']);
    expect(spendCommands()).toHaveLength(1);
    await runtime.run(['Summer launch campaign']);

    expect(selected).toEqual([false, true, false]);
    expect(spendCommands()).toHaveLength(1);
    expect(lines).toContain('  ⚠️ /ad: spending is closed for this run — estimated 18 credits; add --spend to enable it.');
  });

  test('wires the category front stage through the existing approval UI without leaking flags into intake', async () => {
    const surveyModule = await import('../src/ad-pipeline/survey.js');
    const conceptModule = await import('../src/ad-pipeline/concept.js');
    const surveyRequests: unknown[] = [];
    const generated: unknown[] = [];
    const approvals: string[] = [];
    const candidateApprovals: { id?: string; label?: string; reason?: string }[] = [];
    spyOn(surveyModule, 'createOmniCrawlSurveyCollector').mockReturnValue({
      collect: (request) => {
        surveyRequests.push(request);
        return [
          { id: 'candidate-1', label: 'First candidate', reason: 'First evidence', evidence: [{ source: 'https://example.com/first', detail: 'First evidence' }] },
          { id: 'candidate-2', label: 'Second candidate', reason: 'Second evidence', evidence: [{ source: 'https://example.com/second', detail: 'Second evidence' }] },
        ];
      },
    });
    spyOn(conceptModule, 'createDefaultConceptGenerator').mockReturnValue({
      generate: (request) => {
        generated.push(request);
        return { candidates: [{ hook: 'Hook', angle: 'Angle' }, { hook: 'Second hook', angle: 'Second angle' }], categoryForbiddenExpressions: ['unsupported claim'], tone: 'evidence-led' };
      },
    });
    const lines: string[] = [];
    const spending: boolean[] = [];
    const runtime = createDashboardAdSlashRuntime({
      approve: (gate, _plan, context) => {
        approvals.push(gate);
        if (gate === 'CONCEPT_OK' && context?.candidateId) {
          candidateApprovals.push({
            id: context.candidateId,
            label: context.candidateLabel,
            reason: context.candidateReason,
          });
          return context.candidateId === 'candidate-2';
        }
        return true;
      },
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: (allowSpend) => { spending.push(allowSpend); return undefined; },
    });

    await runtime.run(['Summer', 'launch', '--category', 'skincare', '--spend']);

    expect(spending).toEqual([true]);
    expect(surveyRequests).toEqual([{ category: 'skincare', brand: 'Summer launch' }]);
    expect(generated).toMatchObject([{ selection: 'candidate-2', survey: { request: { category: 'skincare', brand: 'Summer launch' } } }]);
    expect(candidateApprovals).toEqual([
      { id: 'candidate-1', label: 'First candidate', reason: 'First evidence' },
      { id: 'candidate-2', label: 'Second candidate', reason: 'Second evidence' },
    ]);
    expect(approvals).toEqual(['CONCEPT_OK', 'CONCEPT_OK', 'CONCEPT_OK', 'BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK']);
    expect(lines.some((line) => line.includes('조사 후보:'))).toBe(true);
    expect(JSON.stringify(lines)).not.toContain('--category');
    expect(JSON.stringify(lines)).not.toContain('skincare');
  });

  test('grounds category front-stage requests with original specs and a cleaned product name, while preserving URL fallback', async () => {
    const surveyModule = await import('../src/ad-pipeline/survey.js');
    const conceptModule = await import('../src/ad-pipeline/concept.js');
    const generated: any[] = [];
    spyOn(surveyModule, 'createOmniCrawlSurveyCollector').mockReturnValue({
      collect: () => [{ id: 'candidate-1', label: 'Candidate', reason: 'Evidence', evidence: [{ source: 'https://example.com/evidence', detail: 'Evidence' }] }],
    });
    spyOn(conceptModule, 'createDefaultConceptGenerator').mockReturnValue({
      generate: (request) => { generated.push(request); return { candidates: [{ hook: 'Hook', angle: 'Angle' }], categoryForbiddenExpressions: [], tone: 'evidence-led' }; },
    });
    const url = 'https://www.musinsa.com/products/7183309';
    const facts = {
      url,
      title: '포켓몬 변신메타몽 납작인형 키링 - 사이즈 & 후기 | 무신사',
      nameCandidates: ['배송/교환/반품 안내', '품번'],
      priceCandidates: ['18,000원'],
      specRows: { 품번: '8800397990432', 성별: '공용', 시즌: '2026' },
      images: [],
    };
    const candidateFacts = { ...facts, title: '상품 상세 | 무신사', nameCandidates: ['키링 | 무신사'] };
    const noisyFacts = { ...facts, title: '상품 상세 | 무신사', nameCandidates: ['배송/교환/반품 안내', '품번'] };
    const blankTitleNoisyFacts = { ...facts, title: '', nameCandidates: ['배송/교환/반품 안내', '품번'] };
    const deliveryProductFacts = { ...facts, title: '배송 트럭 미니카 - 사이즈 & 후기 | 무신사', nameCandidates: ['배송/교환/반품 안내'] };
    const exchangeProductFacts = { ...facts, title: '상품 상세 | 무신사', nameCandidates: ['배송/교환/반품 안내', '교환 일기 노트 | 무신사'] };
    const dir = mkdtempSync(join(tmpdir(), 'ad-tui-grounded-front-'));
    const factsPath = join(dir, 'facts.json');
    const candidateFactsPath = join(dir, 'candidate-facts.json');
    const noisyFactsPath = join(dir, 'noisy-facts.json');
    const blankTitleNoisyFactsPath = join(dir, 'blank-title-noisy-facts.json');
    const deliveryProductFactsPath = join(dir, 'delivery-product-facts.json');
    const exchangeProductFactsPath = join(dir, 'exchange-product-facts.json');
    writeFileSync(factsPath, JSON.stringify(facts));
    writeFileSync(candidateFactsPath, JSON.stringify(candidateFacts));
    writeFileSync(noisyFactsPath, JSON.stringify(noisyFacts));
    writeFileSync(blankTitleNoisyFactsPath, JSON.stringify(blankTitleNoisyFacts));
    writeFileSync(deliveryProductFactsPath, JSON.stringify(deliveryProductFacts));
    writeFileSync(exchangeProductFactsPath, JSON.stringify(exchangeProductFacts));
    const runtime = createDashboardAdSlashRuntime({
      approve: () => true, report: () => {}, muted: (text) => text, warning: (text) => text,
    });

    try {
      await runtime.run([url, '--facts', factsPath, '--category', 'character goods']);
      await runtime.run([url, '--category', 'character goods']);
      await runtime.run([url, '--facts', candidateFactsPath, '--category', 'character goods']);
      await runtime.run([url, '--facts', noisyFactsPath, '--category', 'character goods']);
      await runtime.run([url, '--facts', blankTitleNoisyFactsPath, '--category', 'character goods']);
      await runtime.run([url, '--facts', deliveryProductFactsPath, '--category', 'character goods']);
      await runtime.run([url, '--facts', exchangeProductFactsPath, '--category', 'character goods']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(generated[0]).toMatchObject({
      survey: { request: { category: 'character goods', brand: '포켓몬 변신메타몽 납작인형 키링' } },
      skuGrounding: { specRows: facts.specRows },
    });
    expect(generated[0].skuGrounding.specRows).toEqual(facts.specRows);
    expect(generated[0].skuGrounding).not.toHaveProperty('legalStatus');
    expect(generated[0].survey.request.brand).not.toContain('http');
    expect(generated[0].survey.request.brand).not.toContain('무신사');
    expect(generated[1]).not.toHaveProperty('skuGrounding');
    expect(generated[1]).toMatchObject({ survey: { request: { category: 'character goods', brand: url } } });
    expect(generated[2]).toMatchObject({ survey: { request: { category: 'character goods', brand: '키링' } }, skuGrounding: { specRows: candidateFacts.specRows } });
    expect(generated[2].survey.request.brand).not.toContain('무신사');
    expect(generated[3]).toMatchObject({ survey: { request: { category: 'character goods', brand: url } }, skuGrounding: { specRows: noisyFacts.specRows } });
    expect(generated[4]).toMatchObject({ survey: { request: { category: 'character goods', brand: url } }, skuGrounding: { specRows: blankTitleNoisyFacts.specRows } });
    expect(generated[5]).toMatchObject({ survey: { request: { category: 'character goods', brand: '배송 트럭 미니카' } }, skuGrounding: { specRows: deliveryProductFacts.specRows } });
    expect(generated[6]).toMatchObject({ survey: { request: { category: 'character goods', brand: '교환 일기 노트' } }, skuGrounding: { specRows: exchangeProductFacts.specRows } });
  });

  test('forwards shots and voice through the category front stage without validating shot markdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ad-tui-shots-'));
    const shotsPath = join(dir, 'shots.md');
    const shotMarkdown = [1, 2, 3].map((shot, index) => `### Shot ${shot}
## 장르 식별
beauty
## 5축 분석
① 톤·감정: calm + clear
③ 구조: ${index === 0 ? 'hook' : index === 2 ? 'climax' : 'buildup'}
④ 후킹 포인트: hydrated skin
카메라: static / wide
렌즈: 50mm
조명: day
색감: neutral
텍스처: clean
## English Prompt
serum reveal ${shot}
## Higgsfield 설정
모델: model
Aspect ratio: 9:16
Duration: 2s
Audio: no`).join('\n\n');
    writeFileSync(shotsPath, shotMarkdown);
    const surveyModule = await import('../src/ad-pipeline/survey.js');
    const conceptModule = await import('../src/ad-pipeline/concept.js');
    const generated: unknown[] = [];
    spyOn(surveyModule, 'createOmniCrawlSurveyCollector').mockReturnValue({
      collect: () => [{ id: 'candidate-1', label: 'Candidate', reason: 'Evidence', evidence: [{ source: 'https://example.com/evidence', detail: 'Evidence' }] }],
    });
    spyOn(conceptModule, 'createDefaultConceptGenerator').mockReturnValue({
      generate: (request) => { generated.push(request); return { candidates: [{ hook: 'Hook', angle: 'Angle' }], categoryForbiddenExpressions: [], tone: 'evidence-led' }; },
    });
    const runtime = createDashboardAdSlashRuntime({
      approve: () => true, report: () => {}, muted: (text) => text, warning: (text) => text,
    });

    try {
      await runtime.run(['Summer launch', '--category', 'skincare', '--shots', shotsPath, '--voice', 'voice-42']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(generated).toMatchObject([{
      selection: 'candidate-1',
      survey: { request: { category: 'skincare', brand: 'Summer launch' } },
      scene: { beats: [{ promptCore: 'serum reveal 1' }, { promptCore: 'serum reveal 2' }, { promptCore: 'serum reveal 3' }] },
      voiceId: 'voice-42',
    }]);
  });

  test('rejects invalid shots and voice options before pipeline invocation', async () => {
    const lines: string[] = [];
    let approvals = 0;
    const runtime = createDashboardAdSlashRuntime({
      approve: () => { approvals++; return true; }, report: (line) => { lines.push(line); }, muted: (text) => text, warning: (text) => text,
    });

    await runtime.run(['Summer', '--category', 'skincare', '--shots', 'first.md', '--shots', 'second.md']);
    await runtime.run(['Summer', '--category', 'skincare', '--voice', 'one', '--voice', 'two']);
    await runtime.run(['Summer', '--category', 'skincare', '--shots', '--spend']);
    await runtime.run(['Summer', '--category', 'skincare', '--voice', '--spend']);
    await runtime.run(['Summer', '--category', 'skincare', '--shots', '/definitely/missing/shots.md']);
    await runtime.run(['Summer', '--shots', 'unused.md']);
    await runtime.run(['Summer', '--voice', 'voice-42']);

    expect(lines.slice(0, 4)).toEqual([
      '  Cannot run /ad: --shots may be specified only once.',
      '  Cannot run /ad: --voice may be specified only once.',
      '  Cannot run /ad: --shots requires a non-option value.',
      '  Cannot run /ad: --voice requires a non-option value.',
    ]);
    expect(lines[4]).toContain('샷 마크다운을 못 읽었다');
    expect(lines.slice(5)).toEqual([
      '  Cannot run /ad: --shots and --voice require --category.',
      '  Cannot run /ad: --shots and --voice require --category.',
    ]);
    expect(approvals).toBe(0);
  });

  test('does not create a front stage without --category and blocks named candidate-selection rejection', async () => {
    const surveyModule = await import('../src/ad-pipeline/survey.js');
    const factory = spyOn(surveyModule, 'createOmniCrawlSurveyCollector');
    const noCategory = createDashboardAdSlashRuntime({
      approve: () => false,
      report: () => {},
      muted: (text) => text,
      warning: (text) => text,
    });

    await noCategory.run(['Summer launch']);
    expect(factory).not.toHaveBeenCalled();

    factory.mockReturnValue({
      collect: () => [{ id: 'candidate-1', label: 'Candidate', reason: 'Evidence', evidence: [{ source: 'https://example.com/evidence', detail: 'Evidence' }] }],
    });
    const lines: string[] = [];
    const rejected = createDashboardAdSlashRuntime({
      approve: (gate) => gate !== 'CONCEPT_OK',
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
    });

    await rejected.run(['Summer launch', '--category', 'skincare']);

    expect(lines).toContain('  /ad blocked: Survey candidate selection rejected at CONCEPT_OK.');
    expect(lines).toContain('  ⚪ QC 를 「돌리지 않았다」');
  });

  test('rejects a missing, option-valued, or duplicate category before opening front-stage or spending paths', async () => {
    const surveyModule = await import('../src/ad-pipeline/survey.js');
    const collector = spyOn(surveyModule, 'createOmniCrawlSurveyCollector');
    const lines: string[] = [];
    const spending: boolean[] = [];
    let approvals = 0;
    const runtime = createDashboardAdSlashRuntime({
      approve: () => { approvals++; return true; },
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: (allowSpend) => { spending.push(allowSpend); return undefined; },
    });

    await runtime.run(['Summer', '--category']);
    await runtime.run(['Summer', '--category', '--spend']);
    await runtime.run(['Summer', '--category', 'skincare', '--category', 'cosmetics']);

    expect(lines).toEqual([
      '  Cannot run /ad: --category requires a non-option value.',
      '  Cannot run /ad: --category requires a non-option value.',
      '  Cannot run /ad: --category may be specified only once.',
    ]);
    expect(collector).not.toHaveBeenCalled();
    expect(approvals).toBe(0);
    expect(spending).toEqual([]);
  });

  test('excludes every --spend token while preserving URL and brief intake exactly', async () => {
    const lines: string[] = [];
    const spending: boolean[] = [];
    const url = 'https://example.com/summer-launch';
    const runtime = createDashboardAdSlashRuntime({
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: (allowSpend) => { spending.push(allowSpend); return undefined; },
    });

    await runtime.run([url, '--spend', '--spend']);
    await runtime.run(['Summer', '--spend', 'launch', '--spend', 'campaign']);
    await runtime.run(['Summer', 'launch', 'campaign']);

    const plans = lines
      .filter((line) => line.startsWith('  /ad plan only: '))
      .map((line) => JSON.parse(line.slice('  /ad plan only: '.length)));
    const [urlPlan, spendBriefPlan, plainBriefPlan] = plans;
    expect(spending).toEqual([true, true, false]);
    expect(urlPlan.intake).toMatchObject({ kind: 'url', url });
    expect(spendBriefPlan.intake).toEqual(plainBriefPlan.intake);
    expect(JSON.stringify(plans)).not.toContain('--spend');
  });

  test('removes category and spend options from URL intake while retaining category-only no-spend policy', async () => {
    const lines: string[] = [];
    const spending: boolean[] = [];
    const url = 'https://example.com/summer-launch';
    const runtime = createDashboardAdSlashRuntime({
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: (allowSpend) => { spending.push(allowSpend); return undefined; },
    });

    await runtime.run([url, '--category', 'skincare', '--spend']);
    await runtime.run([url, '--category', 'skincare']);

    expect(spending).toEqual([true, false]);
    const plans = lines
      .filter((line) => line.startsWith('  /ad plan only: '))
      .map((line) => JSON.parse(line.slice('  /ad plan only: '.length)));
    expect(plans.map((plan) => plan.intake)).toEqual([
      { kind: 'url', url },
      { kind: 'url', url },
    ]);
    expect(JSON.stringify(plans)).not.toContain('--category');
    expect(JSON.stringify(plans)).not.toContain('--spend');
  });

  test('wires valid URL facts into plan and execution while removing facts, category, and spend options from intake', async () => {
    const url = 'https://example.com/summer-launch';
    const dir = mkdtempSync(join(tmpdir(), 'ad-tui-facts-'));
    const factsPath = join(dir, 'facts.json');
    const facts = {
      url,
      title: 'Summer launch',
      nameCandidates: ['Summer serum'],
      priceCandidates: ['29,000원'],
      specRows: { category: 'skincare' },
      images: [{ src: 'https://example.com/hero.png', w: 1200, h: 1600 }],
    };
    writeFileSync(factsPath, JSON.stringify(facts));
    const lines: string[] = [];
    const planRuntime = createDashboardAdSlashRuntime({
      report: (line) => { lines.push(line); }, muted: (text) => text, warning: (text) => text,
    });
    const runtime = createDashboardAdSlashRuntime({
      approve: () => false, report: (line) => { lines.push(line); }, muted: (text) => text, warning: (text) => text,
    });

    try {
      await planRuntime.run([url, '--facts', factsPath, '--category', 'skincare', '--spend']);
      await runtime.run([url, '--facts', factsPath]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const plan = JSON.parse(lines.find((line) => line.startsWith('  /ad plan only: '))!.slice('  /ad plan only: '.length));
    expect(plan.prerequisites).toEqual([]);
    expect(plan.productionReadiness).toContainEqual({ step: 'ground', status: 'wired', by: 'page facts' });
    expect(JSON.stringify(plan)).not.toContain('--facts');
    expect(JSON.stringify(plan)).not.toContain(factsPath);
    expect(JSON.stringify(plan)).not.toContain('--category');
    expect(JSON.stringify(plan)).not.toContain('--spend');
    expect(lines).toContain('  /ad stopped: approval rejected at BRIEF_OK.');
  });

  test('blocks malformed, mismatched, and non-URL facts with named reasons before launch', async () => {
    const url = 'https://example.com/summer-launch';
    const dir = mkdtempSync(join(tmpdir(), 'ad-tui-invalid-facts-'));
    const malformedPath = join(dir, 'malformed.json');
    const mismatchedPath = join(dir, 'mismatched.json');
    writeFileSync(malformedPath, '{');
    writeFileSync(mismatchedPath, JSON.stringify({
      url: 'https://example.com/other', title: 'Other', nameCandidates: [], priceCandidates: [], specRows: {}, images: [],
    }));
    const lines: string[] = [];
    let approvals = 0;
    const runtime = createDashboardAdSlashRuntime({
      approve: () => { approvals++; return true; }, report: (line) => { lines.push(line); }, muted: (text) => text, warning: (text) => text,
    });

    try {
      await runtime.run([url, '--facts', malformedPath]);
      await runtime.run([url, '--facts', mismatchedPath]);
      await runtime.run(['Summer launch', '--facts', mismatchedPath]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(approvals).toBe(0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('접지 사실 JSON 을 못 읽었다');
    expect(lines[1]).toContain('접지 사실이 «다른 주소»의 것이다');
    expect(lines[2]).toContain('--facts 는 판매 URL 갈래에서만 쓴다.');
  });

  test('collects URL grounding through the injected browser path, preserves manual facts precedence, and fails closed otherwise', async () => {
    const url = 'https://example.com/summer-launch';
    const facts = {
      url, title: 'Summer launch', nameCandidates: ['Summer serum'], priceCandidates: ['29,000원'],
      specRows: { category: 'skincare' }, images: [{ src: 'https://example.com/hero.png', w: 1200, h: 1600 }],
    };
    const dir = mkdtempSync(join(tmpdir(), 'ad-tui-collector-'));
    const factsPath = join(dir, 'facts.json');
    writeFileSync(factsPath, JSON.stringify(facts));
    const collected: { url: string; snippet: string }[] = [];
    const successfulLines: string[] = [];
    const successful = createDashboardAdSlashRuntime({
      approve: () => true, report: (line) => { successfulLines.push(line); }, muted: (text) => text, warning: (text) => text,
      collectGroundingFacts: async (collectedUrl, snippet) => {
        collected.push({ url: collectedUrl, snippet });
        return facts;
      },
    });
    let manualCollectorCalls = 0;
    const manualLines: string[] = [];
    const manual = createDashboardAdSlashRuntime({
      approve: () => true, report: (line) => { manualLines.push(line); }, muted: (text) => text, warning: (text) => text,
      collectGroundingFacts: async () => { manualCollectorCalls++; throw new Error('manual facts should win'); },
    });
    const thrownLines: string[] = [];
    let thrownApprovals = 0;
    const thrown = createDashboardAdSlashRuntime({
      approve: () => { thrownApprovals++; return true; }, report: (line) => { thrownLines.push(line); }, muted: (text) => text, warning: (text) => text,
      collectGroundingFacts: async () => { throw new Error('browser unavailable'); },
    });
    const mismatchedLines: string[] = [];
    const mismatched = createDashboardAdSlashRuntime({
      approve: () => true, report: (line) => { mismatchedLines.push(line); }, muted: (text) => text, warning: (text) => text,
      collectGroundingFacts: async () => ({ ...facts, url: 'https://example.com/other' }),
    });
    const missingLines: string[] = [];
    const missing = createDashboardAdSlashRuntime({
      approve: () => true, report: (line) => { missingLines.push(line); }, muted: (text) => text, warning: (text) => text,
    });

    try {
      await successful.run([url]);
      await manual.run([url, '--facts', factsPath]);
      await thrown.run([url]);
      await mismatched.run([url]);
      await missing.run([url]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ url });
    expect(collected[0]!.snippet).toContain('measureImages');
    expect(successfulLines.some((line) => /[✅⛔] (통과|미통과) — https:\/\/example\.com\/summer-launch/.test(line))).toBe(true);
    expect(successfulLines).toContain('  /ad production incomplete: invariants (concept result), cut (shoot backend), voiceover (voice lines), soundtrack (sound command runner), render (render command runner).');
    expect(successfulLines).toContain('  /ad production not yet implemented: expand.');
    expect(manualCollectorCalls).toBe(0);
    expect(manualLines.some((line) => /[✅⛔] (통과|미통과) — https:\/\/example\.com\/summer-launch/.test(line))).toBe(true);
    expect(thrownLines).toEqual(['  Cannot run /ad: 접지 사실을 수집하지 못했다: browser unavailable']);
    expect(thrownLines.some((line) => line.includes('접지 수집기가 없어'))).toBe(false);
    expect(thrownLines.some((line) => line.startsWith('  /ad blocked:'))).toBe(false);
    expect(thrownApprovals).toBe(0);
    expect(mismatchedLines).toContain(`  Cannot run /ad: 접지 사실이 «다른 주소»의 것이다 — 요청=${url} · 사실=https://example.com/other`);
    expect(missingLines.some((line) => line.includes('접지 수집기가 없어 판정을 «못 쟀다»'))).toBe(true);
  });

  test('reports only present action reasons before incomplete details and QC for successful and incomplete production', async () => {
    const pipeline = await import('../src/ad-pipeline/run.js');
    const successLines: string[] = [];
    const incompleteLines: string[] = [];
    const plainLines: string[] = [];
    const runtime = (lines: string[]) => createDashboardAdSlashRuntime({
      approve: () => true, report: (line) => { lines.push(line); }, muted: (text) => text, warning: (text) => text,
    });
    const plan = {
      disclosure: { step: 'generated-asset-disclosure', text: '표식 원문' },
      sceneWarnings: ['Beat 1 duration 4s is outside the recommended 5–7 seconds.', 'Beat 2 duration 4s is outside the recommended 5–7 seconds.'],
      concept: {
        copyProvenance: {
          sourceId: 'https://example.com/source',
          lines: [
            { beatIndex: 0, verbatim: true, longestSharedRun: 12 },
            { beatIndex: 1, verbatim: false, longestSharedRun: 7 },
          ],
        },
      },
      shotParse: { missing: ['scene'], formatMismatch: 'formatMismatch' },
      masterAudioReason: 'no-sound-plan-output',
    };
    spyOn(pipeline, 'runAdPipeline').mockResolvedValueOnce({
      status: 'gates-approved', plan, unwiredProduction: [], productionReadiness: [], masterPath: '/work/master.mp4',
      captionBlocked: ['missing-font-path'], shootAssets: [{ beatIndex: 0, limitedBy: 'credit-limit' }],
      productionScene: { selected: 'concept', sources: 'concept' }, unpriced: [{ beatIndex: 0, name: 'model', reason: 'missing-rate' }],
    } as never).mockResolvedValueOnce({
      status: 'gates-approved', plan, unwiredProduction: ['expand'], productionReadiness: [{ step: 'expand', status: 'unwired' }],
      captionBlocked: ['missing-font-path'], shootAssets: [{ beatIndex: 0, limitedBy: 'credit-limit' }],
      unpriced: [{ beatIndex: 1, name: 'model', reason: 'missing-duration-rule' }],
      trimDisagreement: [{ beatIndex: 0, clip: 1, scene: 2 }],
    } as never).mockResolvedValueOnce({
      status: 'gates-approved', plan: {}, unwiredProduction: [], productionReadiness: [], masterPath: '/work/plain.mp4',
    } as never);

    await runtime(successLines).run(['Summer launch campaign']);
    await runtime(incompleteLines).run(['Summer launch campaign']);
    await runtime(plainLines).run(['Summer launch campaign']);

    const reasonLines = [
      '  /ad disclosure: 표식 원문',
      '  /ad scene warnings: Beat 1 duration 4s is outside the recommended 5–7 seconds. · Beat 2 duration 4s is outside the recommended 5–7 seconds.',
      '  /ad copy provenance: https://example.com/source · 원문 그대로 1/2줄 (가장 긴 공유 12자)',
      '  /ad shot parse: formatMismatch',
      '  /ad captions blocked: missing-font-path',
      '  /ad master audio: no-sound-plan-output',
      '  /ad shooting limited by: credit-limit',
    ];
    expect(successLines).toContain('  /ad production completed: /work/master.mp4');
    expect(successLines).toEqual(expect.arrayContaining(reasonLines));
    expect(successLines).toContain('  /ad shooting skipped: Beat 1 — missing-rate');
    expect(successLines.indexOf(reasonLines[0]!)).toBeLessThan(successLines.indexOf('  ⚪ QC 를 「돌리지 않았다」'));
    expect(incompleteLines).toEqual(expect.arrayContaining(reasonLines));
    expect(incompleteLines).toContain('  /ad shooting skipped: Beat 2 — missing-duration-rule');
    expect(incompleteLines.indexOf(reasonLines[0]!)).toBeLessThan(incompleteLines.indexOf('  /ad production not yet implemented: expand.'));
    expect(plainLines).not.toContain('  /ad disclosure: 표식 원문');
    expect(plainLines.join('\n')).not.toContain('/ad copy provenance:');
    expect(successLines.join('\n')).not.toContain('productionScene');
    expect(successLines.join('\n')).not.toContain('unpriced');
    expect(incompleteLines.join('\n')).not.toContain('trimDisagreement');
  });

  test('reports a safezone frame only beside the completed master without changing QC reporting', async () => {
    const pipeline = await import('../src/ad-pipeline/run.js');
    const withSafezone: string[] = [];
    const withoutSafezone: string[] = [];
    const runtime = (lines: string[]) => createDashboardAdSlashRuntime({
      approve: () => true, report: (line) => { lines.push(line); }, muted: (text) => text, warning: (text) => text,
    });
    spyOn(pipeline, 'runAdPipeline').mockResolvedValueOnce({
      status: 'gates-approved', plan: {}, unwiredProduction: [], productionReadiness: [],
      masterPath: '/work/master.mp4', safezonePath: '/work/master-safezone.png',
    } as never).mockResolvedValueOnce({
      status: 'gates-approved', plan: {}, unwiredProduction: [], productionReadiness: [], masterPath: '/work/master-only.mp4',
    } as never);

    await runtime(withSafezone).run(['Summer launch campaign']);
    await runtime(withoutSafezone).run(['Summer launch campaign']);

    const safezoneLine = '  /ad safezone frame: /work/master-safezone.png — 위·아래·오른쪽 띠가 가리는 영역을 확인하세요.';
    expect(withSafezone.filter((line) => line === safezoneLine)).toHaveLength(1);
    expect(withSafezone.indexOf('  /ad production completed: /work/master.mp4')).toBeLessThan(withSafezone.indexOf(safezoneLine));
    expect(withSafezone.indexOf(safezoneLine)).toBeLessThan(withSafezone.indexOf('  ⚪ QC 를 「돌리지 않았다」'));
    expect(withSafezone).toContain('  /ad production completed: /work/master.mp4');
    expect(withSafezone).toContain('  ⚪ QC 를 「돌리지 않았다」');
    expect(withoutSafezone.some((line) => line.includes('/ad safezone frame:'))).toBe(false);
    expect(withoutSafezone).toContain('  /ad production completed: /work/master-only.mp4');
    expect(withoutSafezone).toContain('  ⚪ QC 를 「돌리지 않았다」');
  });

  test('separates production input needs from unimplemented steps and preserves legacy readiness reporting', async () => {
    const pipeline = await import('../src/ad-pipeline/run.js');
    const lines: string[] = [];
    const runtime = createDashboardAdSlashRuntime({
      approve: () => true,
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
    });
    const result = { status: 'gates-approved' as const, unwiredProduction: ['cut', 'expand'] as const, productionReadiness: [
      { step: 'cut' as const, status: 'needs-input' as const, missing: 'shoot backend' },
      { step: 'expand' as const, status: 'unwired' as const },
    ] };
    spyOn(pipeline, 'runAdPipeline').mockResolvedValueOnce(result as never)
      .mockResolvedValueOnce({ ...result, unwiredProduction: ['expand'], productionReadiness: [result.productionReadiness[1]] } as never)
      .mockResolvedValueOnce(({ status: 'gates-approved', unwiredProduction: ['expand'] } as never));

    await runtime.run(['Summer launch campaign']);
    await runtime.run(['Summer launch campaign']);
    await runtime.run(['Summer launch campaign']);

    expect(lines).toContain('  /ad production incomplete: cut (shoot backend).');
    expect(lines).toContain('  /ad production not yet implemented: expand.');
    expect(lines.filter((line) => line.includes('production incomplete'))).toHaveLength(2);
  });

  test('does not fall back to static production when the spend-aware factory returns undefined', async () => {
    const lines: string[] = [];
    const rendered: string[] = [];
    const runtime = createDashboardAdSlashRuntime({
      approve: () => true,
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      productionForSpend: () => undefined,
      production: { render: { run: async () => { rendered.push('static'); return { stdout: '', stderr: '', exitCode: 0 }; } } },
    });

    await runtime.run(['Summer launch campaign']);

    expect(rendered).toEqual([]);
    expect(lines).toContain('  /ad production incomplete: ground (page facts), invariants (concept result), cut (shoot backend), voiceover (voice lines), soundtrack (sound command runner), render (render command runner).');
    expect(lines).toContain('  /ad production not yet implemented: expand.');
  });

  test('keeps static production compatibility when no spend-aware factory is supplied', async () => {
    const lines: string[] = [];
    const runtime = createDashboardAdSlashRuntime({
      approve: () => false,
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      production: {},
    });

    await runtime.run(['Summer launch campaign']);

    expect(lines).toEqual([
      '  /ad stopped: approval rejected at BRIEF_OK.',
      '  ⚪ QC 를 「돌리지 않았다」',
    ]);
  });

  test('renders aggregate QC verdicts and every noteworthy finding without reassessment', () => {
    const lines: string[] = [];

    reportAdQc({
      verdict: 'regenerate',
      automatedVerdict: 'regenerate',
      manualReviewPending: ['identity-consistency'],
      findings: [
        { name: 'audio-peak', verdict: 'regenerate' },
        { name: 'dialogue-loudness', verdict: 'unmeasured', reason: 'threshold unavailable' },
        { name: 'identity-consistency', verdict: 'unmeasured' },
        { name: 'safe-area', verdict: 'ok' },
      ],
    }, (line) => { lines.push(line); }, (text) => text);

    expect(lines).toEqual([
      '  /ad QC verdict: regenerate  (기계: regenerate · 사람 대기: 1축)',
      '  /ad QC regenerate: audio-peak',
      '  ⚪ 못 쟀다: dialogue-loudness — threshold unavailable — 「없다」가 «아니다»',
      '  👤 사람 검토 대기: identity-consistency',
    ]);

    // ⛔ 「모른다」는 «넷»이다 — undefined · '' · 공백만 · (장차) 'unknown'.
    //    `?? ` 는 첫째만 잡는다. 셋째를 빠뜨리면 화면에 `—  —` 가 남는다.
    const whitespaceReason: string[] = [];
    reportAdQc({ verdict: 'unmeasured', automatedVerdict: 'unmeasured', manualReviewPending: [], findings: [{ name: 'manual-review', verdict: 'unmeasured', reason: '   ' }] }, (line) => { whitespaceReason.push(line); }, (text) => text);
    expect(whitespaceReason).toEqual([
      '  /ad QC verdict: unmeasured  (기계: unmeasured · 사람 대기: 0축)',
      '  ⚪ 못 쟀다: manual-review — 사유 없음 — 「없다」가 «아니다»',
    ]);

    const blankReason: string[] = [];
    reportAdQc({ verdict: 'unmeasured', automatedVerdict: 'unmeasured', manualReviewPending: [], findings: [{ name: 'manual-review', verdict: 'unmeasured', reason: '' }] }, (line) => { blankReason.push(line); }, (text) => text);
    expect(blankReason).toEqual([
      '  /ad QC verdict: unmeasured  (기계: unmeasured · 사람 대기: 0축)',
      '  ⚪ 못 쟀다: manual-review — 사유 없음 — 「없다」가 «아니다»',
    ]);
  });

  test('renders captioned findings with a version label', () => {
    const lines: string[] = [];

    reportAdQc({
      verdict: 'regenerate', automatedVerdict: 'regenerate', manualReviewPending: [], findings: [],
      captioned: { verdict: 'regenerate', findings: [{ name: 'caption-burned-in', verdict: 'regenerate' }] },
    }, (line) => { lines.push(line); }, (text) => text);
    expect(lines).toContain('  /ad QC (자막본) regenerate: caption-burned-in');

    lines.splice(0);
    reportAdQc({
      verdict: 'unmeasured', automatedVerdict: 'unmeasured', manualReviewPending: [], findings: [],
      captioned: { verdict: 'unmeasured', findings: [{ name: 'caption-burned-in', verdict: 'unmeasured', reason: 'ocr-frame-extraction-failed' }] },
    }, (line) => { lines.push(line); }, (text) => text);
    expect(lines).toContain('  ⚪ 못 쟀다 (자막본): caption-burned-in — ocr-frame-extraction-failed — 「없다」가 «아니다»');
  });

  test('renders an aggregate ok verdict without reassessment', () => {
    const lines: string[] = [];

    reportAdQc({ verdict: 'ok', automatedVerdict: 'ok', manualReviewPending: [], findings: [{ name: 'audio-peak', verdict: 'ok' }] }, (line) => { lines.push(line); }, (text) => text);

    expect(lines).toEqual(['  /ad QC verdict: ok  (기계: ok · 사람 대기: 0축)']);
  });

  test('keeps the master completion and runtime regenerate verdict visible together', async () => {
    const lines: string[] = [];
    const runtime = createDashboardAdSlashRuntime({
      approve: () => true,
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      production: {
        assembly: {
          clips: [{ beatIndex: 0, path: '/source/0.mp4', probe: { width: 1080, height: 1920, fps: '30/1', codec: 'h264', hasAudio: false } }],
          options: { workDir: '/work', outputName: 'master.mp4' },
          scene: {
            beats: [{ role: 'hook', startSec: 0, endSec: 2, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'campaign', checks: [] }],
            axes: { hook: 'campaign', totalSeconds: 2, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
            aspectRatio: '9:16', forbidden: [], provenance: 'generated',
          },
        },
        render: { run: async (argv) => ({
          stdout: argv[0] === 'ffprobe' ? '{"streams":[{"width":1080,"height":1920}],"format":{"duration":"2"}}' : '',
          stderr: argv.includes('volumedetect') ? 'max_volume: -0.5 dB' : '',
          exitCode: 0,
        }) },
      },
    });

    await runtime.run(['Summer launch campaign']);

    expect(lines).toContain('  /ad production completed: /work/master.mp4');
    expect(lines).toContain('  /ad QC verdict: regenerate  (기계: regenerate · 사람 대기: 4축)');
    expect(lines).toContain('  /ad QC regenerate: audio-peak');
  });

  test('distinguishes QC not run from unmeasured QC findings', () => {
    const lines: string[] = [];

    reportAdQc(undefined, (line) => { lines.push(line); }, (text) => text);

    expect(lines).toEqual(['  ⚪ QC 를 「돌리지 않았다」']);
  });

  test('does not report a preflight warning when production inputs are empty or omitted', async () => {
    for (const missingProductionInputs of [undefined, []] as const) {
      const lines: string[] = [];
      const runtime = createDashboardAdSlashRuntime({
        approve: () => false,
        report: (line) => { lines.push(line); },
        muted: (text) => text,
        warning: (text) => text,
        missingProductionInputs,
      });

      await runtime.run(['Summer launch campaign']);

      expect(lines).toEqual([
        '  /ad stopped: approval rejected at BRIEF_OK.',
        '  ⚪ QC 를 「돌리지 않았다」',
      ]);
    }
  });

  test('outputs the shared plan and does not execute when the dashboard approver is unavailable', async () => {
    const lines: string[] = [];
    const runtime = createDashboardAdSlashRuntime({
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
    });

    await runtime.run(['Summer launch campaign']);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith('  /ad plan only: ');
    const plan = JSON.parse(lines[0]!.slice('  /ad plan only: '.length));
    expect(plan.intake).toMatchObject({ kind: 'text', brief: 'Summer launch campaign' });
    expect(plan.unwiredProduction).toBeArray();
    expect(lines[1]).toBe('  /ad execution was not started because the approval UI is unavailable.');
  });

  test('reports a surface-local setup failure without requesting approval or claiming completion', async () => {
    const lines: string[] = [];
    let approvals = 0;
    const runtime = createDashboardAdSlashRuntime({
      approve: () => { approvals++; return true; },
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
      outputSetupError: 'measured contracts are unavailable',
    });

    await runtime.run(['Summer launch campaign']);

    expect(approvals).toBe(0);
    expect(lines).toEqual([
      '  /ad blocked: measured contracts are unavailable',
      '  ⚪ QC 를 「돌리지 않았다」',
    ]);
  });

  // ⛔⭐ 이 시험은 «소스 문자열»을 물던 것이었다 — 그러면 「비워 가는 옛 switch」를 «못 박는다».
  //    🩸 실제로 그랬다: `/ad` 를 그 switch 에 꽂았더니 레지스트리 동기화 자가 main 을 2 fail 로 만들었고,
  //       이 시험은 «그 잘못된 자리»를 초록으로 지켜 주고 있었다.
  //    ⇒ 이제 «누른다» — 레지스트리가 그 이름을 알고, 핸들러가 런타임을 «실제로» 부르는지.
  test('/ad 는 «형제들이 사는» 레지스트리에 등록돼 있고, 그 핸들러가 런타임을 부른다', async () => {
    const { buildDashboardSlashRegistry } = await import('../src/dashboard/slash-runtime/index.js');
    const calls: string[][] = [];
    let scrolled: number | undefined;
    const ctx = {
      ad: { run: async (args: readonly string[]) => { calls.push([...args]); } },
      setChatScrollOffset: (n: number) => { scrolled = n; },
    } as unknown as Parameters<ReturnType<typeof buildDashboardSlashRegistry>['dispatch']>[2];

    await buildDashboardSlashRegistry().dispatch('ad', ['Summer', 'launch'], ctx);
    expect(calls).toEqual([['Summer', 'launch']]);
    expect(scrolled).toBe(-1);
  });

  // ⛔ 그리고 「목록에만 있고 등록은 안 됐다」가 다시 나면 이것이 잡는다(자는 이미 있었다 — 아무도 안 눌렀을 뿐).
  test('/ad 가 «목록»과 «등록» 양쪽에 있다 — 한쪽만 있으면 카탈로그 동기화 자가 문다', async () => {
    const { buildDashboardSlashRegistry } = await import('../src/dashboard/slash-runtime/index.js');
    const { SLASH_COMMANDS } = await import('../src/chat/index.js');
    expect(SLASH_COMMANDS.some((command) => command.name === 'ad')).toBe(true);
    expect(buildDashboardSlashRegistry().names()).toContain('ad');
  });

  test('showDashboard /ad dispatch invokes approval, writes chat output, and redraws', async () => {
    const lines: string[] = [];
    const approvalRequests: string[] = [];
    let redraws = 0;
    const runtime = createDashboardAdSlashRuntime({
      approve: (gate) => { approvalRequests.push(gate); return false; },
      report: (line) => { lines.push(line); },
      muted: (text) => text,
      warning: (text) => text,
    });

    await dispatchDashboardAdSlash(runtime, ['Summer launch campaign'], () => { redraws++; });

    expect(approvalRequests).toEqual(['BRIEF_OK']);
    expect(lines).toEqual([
      '  /ad stopped: approval rejected at BRIEF_OK.',
      '  ⚪ QC 를 「돌리지 않았다」',
    ]);
    expect(redraws).toBe(1);
  });
});
