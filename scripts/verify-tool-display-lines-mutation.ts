#!/usr/bin/env bun

import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const sourceScript = join(repositoryRoot, 'scripts/measure-tool-display-lines.ts');
const sourceTest = join(repositoryRoot, 'test/tool-display-lines.test.ts');
const attributionReturn = `  return budget.source === 'listing'
    ? \`LISTING_TOOL_MAX_LINES (\${budget.maxLines})\`
    : \`CHAT_DEFAULTS.rendering.tool.blockMaxLines (\${budget.maxLines})\`;`;

function runFocusedTest(cwd: string, testFile: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, 'test', testFile],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    output: `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`,
  };
}

function summary(stage: string, result: { exitCode: number; output: string }): void {
  const counts = result.output.match(/\d+ pass\n\s*\d+ fail/)?.[0]?.replace(/\s+/g, ' ') ?? 'test counts unavailable';
  console.log(`${stage}: exit=${result.exitCode}; ${counts}`);
}

/** 실행에서 `N pass / M fail` 을 뽑는다. 카운트가 없으면 **테스트가 돌지 않은 것**이다
 *  (모듈 해석 실패·크래시). ⇒ 그 경우 `null` 을 돌려 호출측이 변이 검출과 구분하게 한다. */
function testCounts(output: string): { pass: number; fail: number } | null {
  const m = output.match(/(\d+)\s+pass\s*\n\s*(\d+)\s+fail/);
  return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}

/** 변이가 깨뜨려야 하는 단언 수 — 귀속(attribution) 제거는 이 둘을 깨뜨린다.
 *  ⛔ 이 수가 안 맞으면 "변이가 검출됐다" 고 말할 수 없다. */
const EXPECTED_MUTATED_FAILURES = 2;

async function main(): Promise<void> {
  const baseline = runFocusedTest(repositoryRoot, sourceTest);
  summary('baseline', baseline);
  if (baseline.exitCode !== 0) process.exitCode = 1;

  const sandbox = await mkdtemp(join(tmpdir(), 'monad-tool-display-mutation-'));
  try {
    const scriptCopy = join(sandbox, 'scripts/measure-tool-display-lines.ts');
    const testCopy = join(sandbox, 'test/tool-display-lines.test.ts');
    await Promise.all([
      mkdir(dirname(scriptCopy), { recursive: true }),
      mkdir(dirname(testCopy), { recursive: true }),
      symlink(join(repositoryRoot, 'src'), join(sandbox, 'src'), 'dir'),
    ]);
    await cp(sourceTest, testCopy);
    const script = await Bun.file(sourceScript).text();
    if (!script.includes(attributionReturn)) {
      throw new Error('mutation target was not found in measure-tool-display-lines.ts');
    }
    await writeFile(scriptCopy, script.replace(attributionReturn, '  return null;'));

    const mutated = runFocusedTest(sandbox, testCopy);
    summary('attribution-removed', mutated);
    // ⛔⭐⭐ 종전엔 `exitCode !== 0` 이면 전부 "변이 검출" 로 인정했다(무인 리뷰 must-fix) —
    //    그러면 **모듈 해석 실패·크래시도 통과**한다. 실제로 하니스 gate 가 같은 이유로
    //    `unknown` 을 냈고, 그 `unknown` 이 이 런을 죽였다. ⇒ 비정상 종료와 변이 검출을 가른다.
    if (mutated.exitCode === 0) {
      throw new Error('attribution-removed mutation unexpectedly passed');
    }
    const mutatedCounts = testCounts(mutated.output);
    if (!mutatedCounts) {
      throw new Error(
        'mutated run produced no test counts — this is a crash or module-load error, '
        + 'NOT a detected mutation. Output tail: ' + mutated.output.slice(-400),
      );
    }
    if (mutatedCounts.fail !== EXPECTED_MUTATED_FAILURES) {
      throw new Error(
        `expected exactly ${EXPECTED_MUTATED_FAILURES} assertion failures from the attribution mutation, `
        + `got ${mutatedCounts.fail} (pass=${mutatedCounts.pass}). `
        + 'A different failure count means the mutation hit something else than the attribution path.',
      );
    }

    const restored = runFocusedTest(repositoryRoot, sourceTest);
    summary('restored', restored);
    if (restored.exitCode !== 0) process.exitCode = 1;
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

void main();
