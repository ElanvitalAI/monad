/**
 * 골 린터 A/B — 한 코퍼스에 두 판의 `lintGoalFile` 을 걸어 태그별 발화와 **판정 차이 전수**를 낸다.
 *
 * ```
 * git worktree add --detach /tmp/before <머지베이스>
 * ln -s "$PWD/node_modules" /tmp/before/node_modules
 * bun scripts/goal-lint-ab.ts /tmp/before . docs/goals
 * ```
 *
 * ⛔ **변수 격리** — 두 실행의 차이가 *"린터 판(版)" 하나*여야 한다:
 *   - `branch` 를 `'main'` 으로 고정한다. 실행 환경의 브랜치가 새면 `launch-branch` 가 A/B 변수가 된다.
 *   - `deps` 를 양쪽 **기본값**으로 둔다. `traced-path` 의 파일 reader 를 주면 그것이 변수가 된다.
 *   - 코퍼스는 **한 디렉터리**를 양쪽에 건다(각 트리의 docs/goals 가 아니다 — 내용이 다를 수 있다).
 *
 * 종료 코드: 0 = 정상, 2 = 인자 오류, 3 = 어느 한쪽에서 린터가 예외를 던짐.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isGoalDocumentFileName } from '../src/self-implement/goal-document.js';

interface Finding { level: string; tag: string; message: string }
export type Result = Record<string, Finding[]>;

export function collectTags(before: Result, after: Result): string[] {
  return [...new Set([...Object.values(before), ...Object.values(after)].flatMap((findings) => findings.map((finding) => finding.tag)))].sort();
}

export function tagRows(files: readonly string[], before: Result, after: Result, tags: readonly string[]) {
  return tags.flatMap((tag) => {
    const beforeCount = firedFiles(files, before, tag).length;
    const afterCount = firedFiles(files, after, tag).length;
    return beforeCount === 0 && afterCount === 0 ? [] : [{ tag, beforeCount, afterCount }];
  });
}

export function otherTags(tags: readonly string[], changedTags: ReadonlySet<string>): string[] {
  return tags.filter((tag) => !changedTags.has(tag));
}

const firedFiles = (files: readonly string[], result: Result, tag: string) =>
  files.filter((file) => (result[file] ?? []).some((finding) => finding.tag === tag));

async function main(): Promise<number> {
  const [beforeRoot, afterRoot, corpusDir, rawOut] = process.argv.slice(2);
  if (!beforeRoot || !afterRoot || !corpusDir) {
    console.error('usage: bun scripts/goal-lint-ab.ts <beforeTree> <afterTree> <corpusDir> [rawResultJson]');
    return 2;
  }

  const files = readdirSync(corpusDir).filter(isGoalDocumentFileName).sort();
  const documents = new Map(files.map((file) => [file, readFileSync(join(corpusDir, file), 'utf8')]));

  async function run(root: string): Promise<{ result: Result; threw: number }> {
    const { lintGoalFile } = await import(`${resolve(root)}/src/self-implement/goal-author.ts`);
    const result: Result = {};
    let threw = 0;
    for (const file of files) {
      try {
        result[file] = lintGoalFile(documents.get(file)!, 'main', {})
          .map((finding: Finding) => ({ level: finding.level, tag: finding.tag, message: finding.message }));
      } catch (error) {
        threw += 1;
        result[file] = [{ level: 'THREW', tag: 'THREW', message: error instanceof Error ? error.message : String(error) }];
      }
    }
    return { result, threw };
  }

  const before = await run(beforeRoot);
  const after = await run(afterRoot);
  const tags = collectTags(before.result, after.result);

  console.log(`코퍼스: ${files.length} 파일 (${corpusDir} 전수)`);
  console.log(`수리 전 트리 ${beforeRoot} — threw=${before.threw}`);
  console.log(`수리 후 트리 ${afterRoot} — threw=${after.threw}\n`);
  console.log('| 태그 | 수리 전 (발화 파일 수) | 수리 후 | 차이 |');
  console.log('|---|---|---|');
  for (const row of tagRows(files, before.result, after.result, tags)) {
    const difference = row.afterCount - row.beforeCount;
    console.log(`| \`${row.tag}\` | ${row.beforeCount} | ${row.afterCount} | ${difference > 0 ? '+' : ''}${difference} |`);
  }

  // ⭐ 수용 기준의 핵심 — 바꾼 검사 **이외**의 판정이 파일 하나라도 달라졌나. 레벨·문면까지 비교한다.
  const signature = (findings: Finding[], tag: string) =>
    JSON.stringify(findings.filter((finding) => finding.tag === tag).map((finding) => `${finding.level}:${finding.message}`).sort());

  const changedTags = new Set(['shell-damage', 'decision-signal-numeric-source', 'decision-signal-numeric-coverage']);
  const driftTags = otherTags(tags, changedTags);
  const drift: string[] = [];
  for (const file of files) {
    for (const tag of driftTags) {
      const beforeSignature = signature(before.result[file] ?? [], tag);
      const afterSignature = signature(after.result[file] ?? [], tag);
      if (beforeSignature !== afterSignature) drift.push(`${file} [${tag}]\n    before=${beforeSignature}\n    after =${afterSignature}`);
    }
  }
  console.log(`\n## shell-damage 이외 검사의 판정 차이 — ${drift.length}건 / ${files.length * driftTags.length} 검사쌍`);
  for (const difference of drift) console.log(`  - ${difference}`);

  const beforeFired = new Set(firedFiles(files, before.result, 'shell-damage'));
  const afterFired = firedFiles(files, after.result, 'shell-damage');
  console.log(`\n## shell-damage 발화 변화`);
  console.log(`- 꺼진 파일 ${files.filter((file) => beforeFired.has(file) && !afterFired.includes(file)).length}건`);
  console.log(`- 남은 파일 ${afterFired.length}건`);
  for (const file of afterFired) console.log(`  - ${file}`);
  console.log(`- 새로 켜진 파일 ${afterFired.filter((file) => !beforeFired.has(file)).length}건`);
  for (const file of afterFired.filter((file) => !beforeFired.has(file))) console.log(`  - ${file}`);

  if (rawOut) {
    const linterHash = (root: string) => {
      const source = readFileSync(join(resolve(root), 'src/self-implement/goal-author.ts'));
      return createHash('sha256').update(source).digest('hex').slice(0, 16);
    };
    const headOf = (root: string) => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(root), encoding: 'utf8' }).trim().slice(0, 9);
      } catch { return '(unknown)'; }
    };
    const compact: Record<string, unknown> = {
      _meta: {
        corpusDir, files: files.length,
        note: 'linterSha256 이 권위값 — gitHead 는 생성 시점의 참고값이라 한 커밋 뒤일 수 있다',
        beforeTree: beforeRoot, beforeLinterSha256: linterHash(beforeRoot), beforeGitHead: headOf(beforeRoot), beforeThrew: before.threw,
        afterTree: afterRoot, afterLinterSha256: linterHash(afterRoot), afterGitHead: headOf(afterRoot), afterThrew: after.threw,
        driftPairs: files.length * driftTags.length, drift: drift.length,
        numericTagDocumentCounts: Object.fromEntries(
          ['decision-signal-numeric-source', 'decision-signal-numeric-coverage'].map((tag) => [tag, {
            before: firedFiles(files, before.result, tag).length,
            after: firedFiles(files, after.result, tag).length,
            total: files.length,
          }]),
        ),
      },
    };
    for (const file of files) {
      compact[file] = {
        before: (before.result[file] ?? []).map((finding) => finding.tag).sort(),
        after: (after.result[file] ?? []).map((finding) => finding.tag).sort(),
      };
    }
    writeFileSync(rawOut, `${JSON.stringify(compact, null, 0)}\n`, 'utf8');
    console.log(`\n원시 결과: ${rawOut} (한 줄 JSON · _meta ⊕ 파일 ${files.length}개 키)`);
  }

  return before.threw + after.threw > 0 ? 3 : 0;
}

if (import.meta.main) process.exit(await main());
