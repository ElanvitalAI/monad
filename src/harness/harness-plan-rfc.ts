import { existsSync, writeFileSync } from 'node:fs';
import { findRepoRootUp } from '../cli/config-test-sync.js';
import { join, resolve } from 'node:path';
import {
  authorMissionRfc,
  createRfcResolver,
  type AuthoredRfc,
  type RfcAuthorContext,
} from '../autopilot/mission-rfc-author.js';
import { extractSlugSource, slugify } from '../autopilot/mission-registry.js';

export interface HarnessPlanRfcOptions {
  dryRun?: boolean;
}

export interface HarnessPlanRfcDeps {
  author?: (context: RfcAuthorContext, resolve: (prompt: string) => Promise<string>) => Promise<AuthoredRfc>;
  resolve?: (prompt: string) => Promise<string>;
  exists?: (path: string) => boolean;
  write?: (path: string, markdown: string) => void;
  print?: (line: string) => void;
  now?: () => Date;
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface HarnessPlanRfcResult {
  /** Repository-relative path for CLI output and callers. */
  path: string;
  markdown: string;
  openQuestions: readonly string[];
  dryRun: boolean;
}

export function harnessPlanRfcRelativePath(goal: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return join('docs', `RFC-${slugify(extractSlugSource(goal))}-${date}.md`);
}

/** ⛔⭐ `rootDir` 를 안 주면 «저장소 루트를 찾는다» — cwd 를 저장소 루트로 «가정하지 않는다».
 *  🩸 무인 리뷰 지적: 결과를 「Repository-relative path」라 부르면서 cwd 를 루트로 가정하면
 *    호출자가 모르는 사이 `<cwd>/docs` 에 쓰인다. 찾지 못하면 그때만 cwd 로 떨어진다. */
export function harnessPlanRfcRoot(rootDir?: string): string {
  return rootDir ?? findRepoRootUp(process.cwd()) ?? process.cwd();
}

export function harnessPlanRfcPath(goal: string, now = new Date(), rootDir?: string): string {
  return resolve(harnessPlanRfcRoot(rootDir), harnessPlanRfcRelativePath(goal, now));
}

export async function runHarnessPlanRfc(
  goal: string,
  options: HarnessPlanRfcOptions = {},
  deps: HarnessPlanRfcDeps = {},
): Promise<HarnessPlanRfcResult> {
  if (deps.env?.MONAD_HARNESS_SPACE_ID?.trim() || (!deps.env && process.env.MONAD_HARNESS_SPACE_ID?.trim())) {
    throw new Error('하니스 자식은 plan RFC를 저작할 수 없습니다; 사람 셸에서 harness plan을 실행하세요.');
  }
  const now = deps.now?.() ?? new Date();
  const path = harnessPlanRfcRelativePath(goal, now);
  const writePath = harnessPlanRfcPath(goal, now, deps.rootDir);
  const exists = deps.exists ?? existsSync;
  // ⛔⭐ 충돌 검사는 «쓰는 판»에만 건다. `--dry-run` 은 아무것도 안 쓰므로 충돌로 죽으면 안 된다
  //   (같은 날 같은 제목을 «미리보기» 하는 것이 실패가 되면 미리보기가 쓸모없어진다).
  //   ⇒ 대신 이미 있다는 사실을 «말해 준다» — 사람이 그때 정한다.
  const collides = exists(writePath);
  if (collides && !options.dryRun) throw new Error(`RFC 파일이 이미 있습니다: ${path}`);

  const author = deps.author ?? authorMissionRfc;
  const resolve = deps.resolve ?? createRfcResolver();
  const authored = await author({ goal }, resolve);
  const print = deps.print ?? console.log;
  // ⛔⭐ 쓰기는 «원자적 배타 생성»이다 — `exists()` 뒤에 쓰면 같은 제목을 동시에 친 둘이
  //   «둘 다» 통과한 뒤 서로를 덮어쓴다(TOCTOU · 무인 리뷰 지적). 'wx' 가 그 창을 없앤다.
  if (!options.dryRun) {
    (deps.write ?? ((target, markdown) => writeFileSync(target, markdown, { encoding: 'utf8', flag: 'wx' })))(writePath, authored.markdown);
  }
  print(`${options.dryRun ? '[dry-run] RFC 경로:' : 'RFC 작성:'} ${path}`);
  if (collides && options.dryRun) print(`⚠️ 이미 있습니다 — 쓰는 판은 거부됩니다: ${path}`);
  for (const question of authored.openQuestions) print(`열린 질문: ${question}`);
  return { path, markdown: authored.markdown, openQuestions: authored.openQuestions, dryRun: options.dryRun === true };
}
