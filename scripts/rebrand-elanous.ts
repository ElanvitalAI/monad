#!/usr/bin/env bun
// 브랜드 개명 monad → elanous (대표 2026-09-26 · 사유: USPTO MONAD 42류 PaaS 살아 있는 등록).
//
// ⭐ 결정적·재실행 가능 — 같은 트리에 두 번 돌려도 결과가 같다(두 번째는 0건). 그래서 «동결 순간»에
//    최신 main 위에서 다시 돌리면 된다(도구를 미리 만들고, 적용은 한 번).
// ⭐ 기본은 드라이런 — 무엇이 몇 번 바뀌는지만 센다. `--apply` 일 때만 쓴다.
//
// 규칙(순서대로 · 대소문자 보존):
//   monadagent → elanous (패키지 이름) · MONAD → ELANOUS · Monad → Elanous · monad → elanous · 모나드 → 엘라누스
//   경로(파일·디렉토리 이름)에도 같은 규칙.
// 보호(안 바꾼다):
//   - 운영 저장소 식별자 `ElanvitalAI/elanous` 와 체크아웃 이름 `monad-agent`(저장소 이름은 별도 결정)
//   - S3 에 실데이터가 있는 접두·버킷(2026-09-26 실측: elanvital-public 4 · openclaw-image-ref 1 · monad-webclone-archive)
//   ⚠️ AWS Secrets 접두는 보호하지 «않는다» — 이 기계 secrets backend 가 aws 가 아니다(실측) · 영상 폴더는 이행이 옮긴다
//   - 제3자 이름 `Monad, Inc`(상표 사유를 적은 문서)
//   - (선택) 앱 스토어 식별자 `com.elanvitalai.monad.{ios,android}` — 대표 2026-09-26 «바꾼다»로 결정. `--keep-app-ids` 면 보호.
// ⛔ 이 파일 자신과 그 시험(규칙 문자열이 곧 입력이다) ⊕ 브랜드 이력 문서는 바꾸지 않는다.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SELF_FILES = [
  'scripts/rebrand-elanous.ts', 'scripts/rebrand-elanous.test.ts',
  'docs/DECISION-brand-elanous-2026-09-26.md',   // 옛 이름을 «기록»으로 남기는 브랜드 이력 문서
  'scripts/migrate-monad-to-elanous.ts', 'scripts/migrate-monad-to-elanous.test.ts',   // 옛 이름이 곧 입력인 운영 이행
  'scripts/botlab/migrate-vm-to-elanous.ts', 'scripts/botlab/migrate-vm-to-elanous.test.ts',   // 봇 VM(systemd) 이행 — 옛 이름이 곧 입력
];

/** appIds 기본 true(대표 2026-09-26: 앱 스토어 ID 도 바꾼다) · `--keep-app-ids` 로만 보호. */
export interface RebrandOptions { appIds?: boolean }

// 저장소 이름은 대소문자를 가리지 않는다(GitHub 가 같은 저장소로 본다 · 시험이 `JOOSUNG80/MONAD-AGENT` 를 쓴다).
const PROTECT_BASE: RegExp[] = [
  /ElanvitalAI\/monad-agent/gi, /monad-agent/gi, /Monad, Inc/g,
  // «밖에 이미 저장된» 이름 — 바꾸면 기존 데이터·등록을 못 찾는다(개명 대상이 아니라 옛 이름으로 남는 식별자).
  /(?<=startsWith\()'monad\/'(?=\))/g,           // S3 백업 키 접두 시험(s3-backup.test) — 아래 DEFAULT_PREFIX 'monad' 와 짝
  // 이행기 .gitignore 줄(보정이 넣는다) — 표지 옆에 있을 때만(원래 줄은 바뀌어야 한다). 없으면 재실행마다 보정이 또 들어간다.
  /(?<=# 개명 이행기\(2026-09-26\)[^\n]*\n)\.monad\//g,
  /(?<=\/\.elanous-test\/\n)\/\.monad-test\//g,
  /monad-webclone-archive/g,                     // S3 버킷 이름(원문 보관 · 실데이터 있음)
  /\^monad\\\//g,                                // S3 키 정규식 `^monad\/…`(ad-retain 시험) — 실제 접두는 옛 이름
  /(?<=const DEFAULT_PREFIX = )'monad'/g,        // S3 최상위 접두 기본값(src/storage/s3.ts) — 기존 백업 경로
  /monad\/(?:publish-cold|publish|webclone)\b/g, // S3 게시·webclone 접두
  /(?<=s3:\/\/[^\s/'"`]+\/)monad\//g,           // 문서의 s3://<bucket>/monad/…
  /monad-backup-(?:pearlplaygroud|\*)/g,         // GCS 버킷
  /monad-confirm/g,                              // Pushcut 알림 이름(휴대폰 앱에 정의)
  /[A-Za-z0-9_]*monad[A-Za-z0-9_]*_bot\b/gi,     // 텔레그램 봇 사용자 이름(텔레그램에 등록)
];
// iOS 번들 ID 는 확장 ID(`.MonadLiveActivity`)까지 한 덩어리(문자열 식별자다).
// 안드로이드는 «패키지 접두»만 — 그 뒤는 Kotlin 클래스 이름이라 파일 이름과 같이 바뀌어야 한다(`...android.MonadApplication`).
const PROTECT_APP_IDS: RegExp[] = [/com\.elanvitalai\.monad\.ios[\w.]*/g, /com\.elanvitalai\.monad\.android/g, /com\/elanvitalai\/monad\/android/g];

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/monadagent/g, 'elanous'],
  [/MONAD/g, 'ELANOUS'],
  [/Monad/g, 'Elanous'],
  [/monad/g, 'elanous'],
  [/모나드/g, '엘라누스'],
];

export interface Counts { [rule: string]: number }

/** 개명 «뒤»에 붙이는 보정 — 개명이 기계적으로 만들 수 없는 것만(정렬 순서·글자 수 래칫·옛 커밋과의 비교).
 *  ⭐ 경로·문면은 «개명 뒤» 기준이다. ⭐ 이미 적용됐으면 건너뛴다(재실행). ⛔ 닻이 없으면 멈춘다(조용히 넘어가지 않는다). */
export interface Fixup { file: string; why: string; find: string; replace: string | ((ctx: FixupContext) => string); all?: boolean }
export interface FixupContext { root: string }

const SORTED = (xs: string[]) => `[${[...xs].sort().map((x) => `'${x}'`).join(', ')}]`;
export const FIXUPS: Fixup[] = [
  { file: 'scripts/release-build.test.ts', why: '정렬 순서(m→e)', all: true,
    find: "toEqual(['SHA256SUMS', 'install.ps1', 'install.sh', 'elanous.tgz', 'uninstall.sh'])",
    replace: `toEqual(${SORTED(['SHA256SUMS', 'install.ps1', 'install.sh', 'elanous.tgz', 'uninstall.sh'])})` },
  { file: 'scripts/resource-map-check.test.ts', why: '정렬 순서(M→E)',
    find: "const injectedNames = ['AWS_SECRET_ACCESS_KEY', 'CLOSURE_API_KEY', 'GROK_CODE_XAI_API_KEY', 'ELANOUS_DISCORD_BOT_TOKEN', 'ELANOUS_LLM_API_KEY', 'ELANOUS_TELEGRAM_BOT_TOKEN', 'PARENTHESIZED_API_KEY'];",
    replace: `const injectedNames = ${SORTED(['AWS_SECRET_ACCESS_KEY', 'CLOSURE_API_KEY', 'GROK_CODE_XAI_API_KEY', 'ELANOUS_DISCORD_BOT_TOKEN', 'ELANOUS_LLM_API_KEY', 'ELANOUS_TELEGRAM_BOT_TOKEN', 'PARENTHESIZED_API_KEY'])};` },
  { file: 'src/self-dev/dev-pipeline.test.ts', why: '정렬 순서(m→e)',
    find: "toEqual(['acp', 'agent-mission-pty', 'interactive', 'elanous-tui', 'parallel', 'plan-staged', 'self-mission', 'shell-drive'])",
    replace: `toEqual(${SORTED(['acp', 'agent-mission-pty', 'interactive', 'elanous-tui', 'parallel', 'plan-staged', 'self-mission', 'shell-drive'])})` },
  { file: 'test/agent-room-transport-pref.test.ts', why: '정렬 순서(m→e)',
    find: "'claude', 'codex', 'gemini', 'local-llm', 'elanous',",
    replace: "'claude', 'codex', 'elanous', 'gemini', 'local-llm'," },
  { file: '.gitignore', why: '이행기 — 옛 판(설치본·옛 체크아웃)이 아직 `.monad/` 에 쓴다: 옛 이름도 계속 무시',
    find: '\n.elanous/\n', replace: '\n.elanous/\n# 개명 이행기(2026-09-26): 옛 판이 아직 옛 이름으로 쓴다(.gitignore 는 줄 끝 주석을 모른다 — 주석은 따로 한 줄)\n.monad/\n' },
  { file: '.gitignore', why: '이행기 — 옛 판의 트리 파생 시험 우주',
    find: '\n/.elanous-test/\n', replace: '\n/.elanous-test/\n/.monad-test/\n' },
  // ⛔ CLAUDE.md 글자 수 래칫은 «보정하지 않는다» — 개명 전 main 에서도 이미 넘어 있다(빨강을 개명이 가리지 않게).
  { file: '.rules/40-collaboration/coordination.md', why: 'sources(매뉴얼)가 개명으로 바뀌었다 — 규칙은 같은 diff 에 있어야 한다(rules-contract)',
    find: 'verified: 2026-08-27\n',
    replace: 'verified: 2026-08-27\n# 2026-09-26 브랜드 개명: sources 는 낱말만 바뀌었다 — 규칙 내용은 그대로다.\n' },
  { file: 'scripts/webclone/loop/make-task.test.ts', why: '옛 커밋(개명 전)의 산출과 비교 — 옛 쪽을 개명 규칙으로 맞춘 뒤 비교',
    find: "const beforeLines = renderParentDefault().toString('utf8').split('\\n');",
    replace: "const beforeLines = rebrandText(renderParentDefault().toString('utf8')).split('\\n');   // 부모 커밋은 개명 전 이름이다(2026-09-26)" },
  { file: 'scripts/webclone/loop/make-task.test.ts', why: '위 보정의 import',
    find: "import { afterEach, describe, expect, test } from 'bun:test';",
    replace: "import { afterEach, describe, expect, test } from 'bun:test';\nimport { rebrandText } from '../../rebrand-elanous.js';" },
];

export function applyFixups(root: string, ctx: FixupContext, apply: boolean): string[] {
  const done: string[] = [];
  for (const fx of FIXUPS) {
    const abs = join(root, fx.file);
    if (!existsSync(abs)) throw new Error(`보정 대상 없음: ${fx.file}(${fx.why})`);
    const body = readFileSync(abs, 'utf8');
    const rep = typeof fx.replace === 'string' ? fx.replace : fx.replace(ctx);
    if (body.includes(rep)) continue;   // 이미 적용(바꿀 문면이 닻을 품는 보정도 있어서 «먼저» 본다 — import 추가)
    if (!body.includes(fx.find)) {
      throw new Error(`보정 닻을 못 찾았다: ${fx.file}(${fx.why}) — ${fx.find.slice(0, 80)}`);
    }
    if (apply) writeFileSync(abs, fx.all ? body.split(fx.find).join(rep) : body.replace(fx.find, rep));
    done.push(`${fx.file} — ${fx.why}`);
  }
  return done;
}

/** 텍스트 한 덩어리를 바꾼다 — 보호 토큰은 자리표로 비켜 두었다가 되돌린다. */
export function rebrandText(s: string, opts: RebrandOptions = {}, counts?: Counts): string {
  const protect = opts.appIds === false ? [...PROTECT_APP_IDS, ...PROTECT_BASE] : PROTECT_BASE;
  const saved: string[] = [];
  let out = s;
  for (const re of protect) {
    out = out.replace(re, (m) => {
      if (counts) counts[`protected:${re.source}`] = (counts[`protected:${re.source}`] ?? 0) + 1;
      saved.push(m);
      return `\u0000${saved.length - 1}\u0000`;
    });
  }
  for (const [re, to] of RULES) {
    out = out.replace(re, () => {
      if (counts) counts[re.source] = (counts[re.source] ?? 0) + 1;
      return to;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[Number(i)]!);
}

/** 경로는 «통째로» 바꾼다 — 보호 토큰이 `/` 를 품을 수 있어서(안드로이드 패키지 경로). */
export function rebrandPath(p: string, opts: RebrandOptions = {}): string {
  return rebrandText(p, opts);
}

function isSymlink(p: string): boolean { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export interface RebrandReport {
  root: string;
  filesScanned: number;
  filesChanged: number;
  renames: number;
  binarySkipped: number;
  counts: Counts;
  sampleRenames: Array<[string, string]>;
  collisions: string[];
  fixups: string[];
  applied: boolean;
}

export function rebrandTree(root: string, opts: RebrandOptions & { apply?: boolean } = {}): RebrandReport {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (ls.status !== 0) throw new Error(`git ls-files 실패(rc=${ls.status}): ${ls.stderr}`);
  const files = ls.stdout.split('\0').filter(Boolean).filter((f) => !SELF_FILES.includes(f));
  const counts: Counts = {};
  let filesChanged = 0, binarySkipped = 0;
  const renames: Array<[string, string]> = [];
  for (const f of files) {
    const abs = join(root, f);
    // 심볼릭 링크: 대상 «경로 문자열»도 같은 규칙으로 — 링크 이름만 바꾸고 대상을 두면 끊긴다(iOS 시험 소스 링크).
    if (isSymlink(abs)) {
      const target = readlinkSync(abs);
      const nt = rebrandPath(target, opts);
      if (nt !== target) {
        filesChanged++;
        counts['symlink-target'] = (counts['symlink-target'] ?? 0) + 1;
        if (opts.apply) { unlinkSync(abs); symlinkSync(nt, abs); }
      }
      const to = rebrandPath(f, opts);
      if (to !== f) renames.push([f, to]);
      continue;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;   // 추적은 되지만 지워진 것
    const buf = readFileSync(abs);
    if (isBinary(buf)) binarySkipped++;
    else {
      const before = buf.toString('utf8');
      const after = rebrandText(before, opts, counts);
      if (after !== before) {
        filesChanged++;
        if (opts.apply) writeFileSync(abs, after);
      }
    }
    const to = rebrandPath(f, opts);
    if (to !== f) renames.push([f, to]);
  }
  // 이름 충돌: 바뀐 경로가 기존 파일(바뀌지 않는 것)이나 다른 바뀐 경로와 겹치면 멈춘다.
  const targets = new Map<string, string>();
  const unchanged = new Set(files.filter((f) => rebrandPath(f, opts) === f));
  const collisions: string[] = [];
  for (const [from, to] of renames) {
    if (unchanged.has(to) || targets.has(to)) collisions.push(`${from} → ${to}`);
    targets.set(to, from);
  }
  if (opts.apply) {
    if (collisions.length) throw new Error(`이름 충돌 ${collisions.length}건 — 적용하지 않는다:\n${collisions.slice(0, 10).join('\n')}`);
    const oldDirs = new Set<string>();
    for (const [from, to] of renames) {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      renameSync(join(root, from), join(root, to));
      for (let d = dirname(from); d !== '.' && d !== ''; d = dirname(d)) oldDirs.add(d);
    }
    // 비게 된 옛 디렉토리를 깊은 것부터 지운다.
    for (const d of [...oldDirs].sort((a, b) => b.length - a.length)) {
      const abs = join(root, d);
      try { if (existsSync(abs) && readdirSync(abs).length === 0) rmdirSync(abs); } catch { /* 남아 있으면 둔다 */ }
    }
  }
  const fixups = opts.apply ? applyFixups(root, { root }, true) : FIXUPS.map((fx) => `${fx.file} — ${fx.why}`);
  return {
    root, filesScanned: files.length, filesChanged, renames: renames.length, binarySkipped, counts,
    sampleRenames: renames.slice(0, 8), collisions, fixups, applied: Boolean(opts.apply),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1]! : process.cwd();
  const report = rebrandTree(root, { apply: argv.includes('--apply'), appIds: !argv.includes('--keep-app-ids') });
  if (argv.includes('--json')) console.log(JSON.stringify(report));
  else {
    console.log(`${report.applied ? '적용' : '드라이런'} — 파일 ${report.filesScanned} 중 내용 변경 ${report.filesChanged} · 이름 변경 ${report.renames} · 바이너리 건너뜀 ${report.binarySkipped} · 이름 충돌 ${report.collisions.length}`);
    for (const [k, v] of Object.entries(report.counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
    for (const [a, b] of report.sampleRenames) console.log(`  ${a} → ${b}`);
    for (const c of report.collisions.slice(0, 10)) console.log(`  ⛔ 충돌 ${c}`);
    for (const x of report.fixups) console.log(`  ${report.applied ? '✓ 보정' : '· 보정 예정'} ${x}`);
  }
  if (report.collisions.length) process.exit(1);
}
