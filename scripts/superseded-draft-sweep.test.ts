import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./superseded-draft-sweep.py', import.meta.url));
const importProgram = `
import importlib.util, json, pathlib, sys
spec = importlib.util.spec_from_file_location('superseded_draft_sweep', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
body = json.loads(sys.stdin.read())
if sys.argv[2] == 'args':
    code, message = module.parse_args(body['argv'])
    print(json.dumps({'code': code, 'message': message}, ensure_ascii=False))
elif sys.argv[2] == 'classify-tests':
    lookup = lambda name: None if name in body.get('unavailable', []) else name in body['existing']
    print(json.dumps(module.classify_test_names(body['diff'], lookup), ensure_ascii=False))
elif sys.argv[2] == 'classify':
    lookup = lambda symbol: None if symbol in body.get('unavailable', []) else symbol in body['existing']
    print(json.dumps(module.classify_symbols(body['diff'], lookup), ensure_ascii=False))
elif sys.argv[2] == 'apply':
    result = module.CommandResult(**body)
    print(json.dumps(module.classify_applicability(result), ensure_ascii=False))
elif sys.argv[2] == 'sweep':
    responses = iter(body['responses'])
    calls = []
    def run(args, input_text=None):
        calls.append({'args': list(args), 'input': input_text})
        response = next(responses)
        return module.CommandResult(**response)
    lookup = lambda symbol: symbol in body['existing']
    print(json.dumps({'result': module.sweep_open_drafts(run, lookup), 'calls': calls}, ensure_ascii=False))
elif sys.argv[2] == 'lookup':
    root = pathlib.Path(body['root'])
    if body.get('read_failure'):
        pathlib.Path.read_text = lambda self, encoding=None: (_ for _ in ()).throw(OSError('read denied'))
    print(json.dumps(module.source_symbol_lookup(body['symbol'], root)))
elif sys.argv[2] == 'main':
    responses = iter(body['responses'])
    def run(args, input_text=None):
        return module.CommandResult(**next(responses))
    lookup = lambda symbol: symbol in body['existing']
    # ⭐ argv 를 «명시»한다 — 안 주면 이 브리지의 sys.argv(스크립트 경로·모드)가 「모르는 인자」로 읽힌다.
    sys.exit(module.main(run, lookup, module.test_name_lookup, []))
`;

type CommandResponse = { started: boolean; returncode: number | null; stdout: string; stderr: string };

function runPython(mode: 'args' | 'classify' | 'classify-tests' | 'apply' | 'sweep' | 'lookup' | 'main', input: unknown): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ['python3', '-B', '-c', importProgram, scriptPath, mode],
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode ?? -1, stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr) };
}

const ok = (stdout = ''): CommandResponse => ({ started: true, returncode: 0, stdout, stderr: '' });
const failed = (stderr: string): CommandResponse => ({ started: true, returncode: 1, stdout: '', stderr });
const unavailable = (stderr = 'spawn failed'): CommandResponse => ({ started: false, returncode: null, stdout: '', stderr });
const productionDiff = [
  'diff --git a/src/value.ts b/src/value.ts',
  '+++ b/src/value.ts',
  '+export function Alpha() {}',
  '+export const Beta = 1',
].join('\n');

// ⭐⭐ 시험명 자 — 「export 선언이 없는 draft」를 위한 «두 번째» 판정.
//   ⛔ 2026-08-27 실측: 열린 draft 24건 중 ***13건***이 첫 자로 「판정 불가」였다(시험 전용이라
//     세울 심볼이 없다). 그 13건이 이 자로 갈린다.
const testOnlyDiff = [
  'diff --git a/src/thing.test.ts b/src/thing.test.ts',
  '+++ b/src/thing.test.ts',
  "+  test('열린 창을 센다', () => {",
  "+  it('닫힌 창은 안 센다', () => {",
].join('\n');

function classifyTests(diff: string, existing: string[], unavailable: string[] = []): {
  testVerdict: string; testNames: number; testNamesPresent: number;
} {
  const result = runPython('classify-tests', { diff, existing, unavailable });
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

// ⛔⭐ 2026-08-27 실측(🅕 33차): 이 도구가 «모르는 플래그를 거부 없이 삼키고» 전수 실행으로 갔다.
//   다음 사람이 --dry-run 이나 --limit 을 「있는 줄 알고」 치면 그것이 전수 실행이 되고
//   그 사실이 «어디에도 안 남는다». 아래 셋이 그 회귀를 막는다.
describe('superseded draft argument contract', () => {
  const parse = (argv: string[]) => {
    const result = runPython('args', { argv });
    expect(result.exitCode, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as { code: number | null; message: string };
  };

  test('인자가 없으면 «진행»한다 (code=null)', () => {
    expect(parse([]).code).toBeNull();
  });

  test('⛔ 모르는 플래그를 «이름을 대고» 거부한다 — 조용히 삼키지 않는다', () => {
    const { code, message } = parse(['--존재하지않는플래그']);
    expect(code).toBe(2);
    expect(message).toContain('--존재하지않는플래그');
  });

  test('--help 와 -h 는 사용법을 내고 «성공»한다', () => {
    for (const flag of ['--help', '-h']) {
      const { code, message } = parse([flag]);
      expect(code).toBe(0);
      expect(message).toContain('옵션은 «없다»');
    }
  });
});

describe('superseded draft test-name verdicts', () => {
  test.each([
    ['모두 있음', ['열린 창을 센다', '닫힌 창은 안 센다'], '시험 이미 있음', 2],
    ['일부 있음', ['열린 창을 센다'], '시험 부분 존재', 1],
    ['하나도 없음', [], '고유 시험', 0],
  ])('%s — 시험명 대조가 그대로 판정이 된다', (_s, existing, verdict, present) => {
    expect(classifyTests(testOnlyDiff, existing as string[])).toEqual({
      testVerdict: verdict, testNames: 2, testNamesPresent: present as number,
    });
  });

  test('시험 파일이 아닌 diff 는 «잴 것이 없어» 판정 불가다 — 「고유 시험」이 아니다', () => {
    expect(classifyTests(productionDiff, [])).toEqual({ testVerdict: '판정 불가', testNames: 0, testNamesPresent: 0 });
  });

  test('⛔ 조회가 «못 읽으면» 판정 불가다 — 「없다」로 승격시키지 않는다', () => {
    expect(classifyTests(testOnlyDiff, [], ['열린 창을 센다'])).toEqual({
      testVerdict: '판정 불가', testNames: 2, testNamesPresent: 0,
    });
  });

  test('같은 이름이 두 번 나와도 «한 번»만 센다', () => {
    const doubled = [testOnlyDiff, "+  test('열린 창을 센다', () => {"].join('\n');
    expect(classifyTests(doubled, [])).toEqual({ testVerdict: '고유 시험', testNames: 2, testNamesPresent: 0 });
  });
});

function classify(diff: string, existing: string[], unavailable: string[] = []): { verdict: string; symbols: string[] } {
  const result = runPython('classify', { diff, existing, unavailable });
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('superseded draft pure symbol verdicts', () => {
  test.each([
    ['replacement candidate', ['Alpha', 'Beta'], '대체 후보'],
    ['partial replacement', ['Alpha'], '부분 대체'],
    ['unique deliverable', [], '고유 산출'],
  ])('%s keeps the requested verdict', (_scenario, existing, verdict) => {
    expect(classify(productionDiff, existing)).toEqual({ verdict, symbols: ['Alpha', 'Beta']});
  });

  test('keeps an unavailable source lookup indeterminate instead of claiming a unique deliverable', () => {
    expect(classify(productionDiff, [], ['Beta'])).toEqual({ verdict: '판정 불가', symbols: ['Alpha', 'Beta']});
  });

  test('default and every excluded export form produce no symbols and remain indeterminate', () => {
    const diff = [
      'diff --git a/src/excluded.ts b/src/excluded.ts',
      '+++ b/src/excluded.ts',
      '+export default function LocalDefault() {}',
      '+export let mutable = 1',
      '+export var legacy = 2',
      '+export enum Mode { A }',
      '+export namespace Space {}',
      '+export abstract class AbstractThing {}',
      '+export { Alpha } from "./alpha.js"',
    ].join('\n');
    expect(classify(diff, ['LocalDefault'])).toEqual({ verdict: '판정 불가', symbols: []});
  });

  test('extracts exactly the five supported declarations and ignores every test-file convention', () => {
    const diff = [
      'diff --git a/src/exports.ts b/src/exports.ts',
      '+++ b/src/exports.ts',
      '+export async function AsyncFunction() {}',
      '+export const Constant = 1',
      '+export class ClassName {}',
      '+export interface Shape {}',
      '+export type Alias = string',
      'diff --git a/scripts/example.test.ts b/scripts/example.test.ts',
      '+++ b/scripts/example.test.ts',
      '+export function TypeScriptTestOnly() {}',
      'diff --git a/scripts/example.test.js b/scripts/example.test.js',
      '+++ b/scripts/example.test.js',
      '+export function JavaScriptTestOnly() {}',
      'diff --git a/scripts/example.spec.js b/scripts/example.spec.js',
      '+++ b/scripts/example.spec.js',
      '+export function JavaScriptSpecOnly() {}',
      'diff --git a/src/__tests__/example.ts b/src/__tests__/example.ts',
      '+++ b/src/__tests__/example.ts',
      '+export function DirectoryTestOnly() {}',
      'diff --git a/tests/nested/example.ts b/tests/nested/example.ts',
      '+++ b/tests/nested/example.ts',
      '+export function TestsDirectoryOnly() {}',
    ].join('\n');
    expect(classify(diff, [])).toEqual({ verdict: '고유 산출', symbols: ['AsyncFunction', 'Constant', 'ClassName', 'Shape', 'Alias']});
  });

  test('finds an existing exported symbol in TSX and ignores test-only source files', () => {
    const root = mkdtempSync(join(tmpdir(), 'superseded-draft-sweep-'));
    try {
      writeFileSync(join(root, 'component.tsx'), 'export function ExistingTsx() {}\n');
      writeFileSync(join(root, 'ignored.test.js'), 'export function TestOnlyJavaScript() {}\n');
      writeFileSync(join(root, 'ignored.spec.js'), 'export function SpecOnlyJavaScript() {}\n');
      const testDirectory = join(root, '__tests__');
      mkdirSync(testDirectory);
      const testsDirectory = join(root, 'tests', 'nested');
      mkdirSync(testsDirectory, { recursive: true });
      writeFileSync(join(testsDirectory, 'ignored.ts'), ['export function TestsDirectoryOnly() {}', ''].join(String.fromCharCode(10)));
      writeFileSync(join(testDirectory, 'ignored.tsx'), 'export function TestDirectoryOnly() {}\n');

      const existing = runPython('lookup', { root, symbol: 'ExistingTsx' });
      expect(existing.exitCode, existing.stderr).toBe(0);
      expect(JSON.parse(existing.stdout)).toBe(true);
      const unreadable = runPython('lookup', { root, symbol: 'MissingAfterReadFailure', read_failure: true });
      expect(unreadable.exitCode, unreadable.stderr).toBe(0);
      expect(JSON.parse(unreadable.stdout)).toBeNull();
      for (const symbol of ['TestOnlyJavaScript', 'SpecOnlyJavaScript', 'TestDirectoryOnly', 'TestsDirectoryOnly']) {
        const ignored = runPython('lookup', { root, symbol });
        expect(ignored.exitCode, ignored.stderr).toBe(0);
        expect(JSON.parse(ignored.stdout)).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('superseded draft git applicability', () => {
  test('treats every started non-zero check, including specified stderr, as non-applicable', () => {
    for (const stderr of ['already exists in working directory', 'No such file or directory', 'does not match index']) {
      const result = runPython('apply', failed(stderr));
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toBe('얹히지 않음');
    }
  });

  test('uses indeterminate only when git could not start', () => {
    const result = runPython('apply', unavailable());
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toBe('판정 불가');
  });
});

describe('superseded draft thin orchestration', () => {
  test('calls gh diff and exactly git apply --check before the injected pure lookup', () => {
    const payload = {
      existing: ['Alpha', 'Beta'],
      responses: [ok(JSON.stringify([{ number: 71, title: 'draft' }])), ok(productionDiff), ok()],
    };
    const result = runPython('sweep', payload);
    expect(result.exitCode).toBe(0);
    const observed = JSON.parse(result.stdout);
    expect(observed.result).toEqual([{
      number: 71, applicability: '얹힘 가능', verdict: '대체 후보', symbols: ['Alpha', 'Beta'],
      // ⭐ 시험명 자는 «두 번째» 판정이다 — 이 픽스처의 diff 에 시험 파일이 없으므로 「판정 불가」가
      //   맞는 값이다. ⛔ 「0 이라서 없다」가 아니라 「잴 것이 없어서 판정 불가」다.
      testVerdict: '판정 불가', testNames: 0, testNamesPresent: 0,
    }]);
    expect(observed.calls).toEqual([
      { args: ['gh', 'pr', 'list', '--state', 'open', '--draft', '--limit', '1000', '--json', 'number,title'], input: null },
      { args: ['gh', 'pr', 'diff', '71', '--patch'], input: null },
      { args: ['git', 'apply', '--check'], input: productionDiff },
    ]);
  });

  test('keeps a started git failure non-applicable on the main orchestration path', () => {
    const responses = [ok(JSON.stringify([{ number: 72, title: 'draft' }])), ok(productionDiff), failed('already exists in working directory')];
    const result = runPython('main', { existing: [], responses });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ number: 72, applicability: '얹히지 않음', verdict: '고유 산출', symbols: ['Alpha', 'Beta'] , testVerdict: '판정 불가', testNames: 0, testNamesPresent: 0 });
  });

  test('reports unavailable draft listing as an actual main failure, never an empty sweep', () => {
    const result = runPython('main', { existing: [], responses: [unavailable('gh missing')] });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('열린 draft 목록을 못 얻었다');
  });
});
