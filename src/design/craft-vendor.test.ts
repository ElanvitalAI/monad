// ── 수입한 `craft/` 규칙서의 «바이트 동일성» 지킴이 ────────────────────────────
//
// ⛔⭐ 왜 있나: `docs/design/craft/` 의 파일은 «우리가 쓴 것이 아니다».
//   OpenDesign(Apache-2.0)에서 바이트 그대로 들여왔고, 그중 `anti-ai-slop.md` 는
//   refero_skill(MIT) 귀속 줄을 품는다. ⇒ 조용한 편집이 «두 라이선스»를 어긴다.
//
// ⭐ 그래서 이 시험은 「고치지 마라」가 아니라 ***「고쳤으면 NOTICE 도 고쳐라」*** 를 강제한다.
//   해시가 어긋나면 → NOTICE.md §3 에 변경을 적고 → 여기 기대값을 갱신한다(그 순서로).
//
// 📚 절차 = docs/design/craft/NOTICE.md §3

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSectionItems } from './design-doc.js';

const REPOSITORY_ROOT = join(import.meta.dir, '..', '..');
const CRAFT_DIR = join(REPOSITORY_ROOT, 'docs', 'design', 'craft');
const PROJECT_SCAFFOLD = join(import.meta.dir, '..', 'self-implement', 'project-scaffold.ts');
const ROOT_DESIGN_DOCUMENT = join(REPOSITORY_ROOT, 'DESIGN.md');

function deriveCraftRulebookNames(entries: readonly string[]): string[] {
  return entries
    .filter((name) => name.endsWith('.md') && name !== 'NOTICE.md')
    .map((name) => name.slice(0, -'.md'.length));
}

/** NOTICE.md is authored locally, not an imported rulebook requiring a checksum. */
function deriveVendoredCraftFileNames(entries: readonly string[]): string[] {
  return entries.filter((name) => name !== 'NOTICE.md');
}

function assertVendoredCraftFilesRegistered(directoryNames: readonly string[], vendored: Readonly<Record<string, string>>): void {
  const registeredNames = Object.keys(vendored);
  const unregistered = directoryNames.filter((name) => !registeredNames.includes(name));
  const unavailableFromDirectory = registeredNames.filter((name) => !directoryNames.includes(name));
  if (unregistered.length || unavailableFromDirectory.length) {
    throw new Error(
      `Vendored craft file registration drift: unregistered checksum-table files: ${unregistered.join(', ') || '(none)'}; unavailable from directory: ${unavailableFromDirectory.join(', ') || '(none)'}.`,
    );
  }
}

function extractNoticeChecksumFileNames(notice: string): string[] {
  return notice
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^[a-f0-9]{64}\s+(\S+)\s*$/i);
      return match ? [match[1]] : [];
    });
}

function assertNoticeRecordsVendoredFiles(vendoredNames: readonly string[], notice: string): void {
  const noticeFileNames = extractNoticeChecksumFileNames(notice);
  const missingFromNotice = vendoredNames.filter((name) => !noticeFileNames.includes(name));
  if (missingFromNotice.length) {
    throw new Error(`Vendored craft files missing from NOTICE: ${missingFromNotice.join(', ')}.`);
  }
}

/** ⛔⭐ 정본 파서를 «부른다» — 여기서 두 번째 loop 를 쓰지 않는다.
 *
 *  🪞 2026-08-25 실측: 이 함수는 원래 문서 «전체»에서 `- ` 줄을 주웠고,
 *  정본(`readSectionItems`)은 `## …` «절»로 끊는다. 그래서 `DESIGN.md` 에
 *  `## Design direction` 절을 더하는 순간 이 지킴이가 그 방향 이름을
 *  «규칙집 이름»으로 오인해 빨개졌다(반증: 2 fail).
 *
 *  ⛔ 그리고 그것을 `design-doc.ts` 가 «이미 경고해 뒀다» —
 *  *"the craft-rulebook list and the design direction are the same shape, and
 *  a second hand-written loop is how the two would drift apart."*
 *  ⇒ 이 함수가 바로 그 second hand-written loop 였다. */
function extractCraftRulebookNames(document: string): string[] {
  return readSectionItems(document, '## Craft rulebooks');
}

function extractScaffoldCraftRulebookNames(scaffoldSource: string): string[] {
  const match = scaffoldSource.match(/\[\['DESIGN\.md'\], '([^']*)'\]/);
  if (!match) throw new Error('SCAFFOLD_FILES has no DESIGN.md seed.');
  return extractCraftRulebookNames(match[1].replaceAll('\\n', '\n'));
}

function assertCraftRulebookNamesMatch(directoryNames: readonly string[], declaredNames: readonly string[], declaration: string): void {
  const missingFromDeclaration = directoryNames.filter((name) => !declaredNames.includes(name));
  const unavailableFromDirectory = declaredNames.filter((name) => !directoryNames.includes(name));
  if (missingFromDeclaration.length || unavailableFromDirectory.length) {
    throw new Error(
      `Craft rulebook declarations drift: missing from ${declaration}: ${missingFromDeclaration.join(', ') || '(none)'}; unavailable from directory: ${unavailableFromDirectory.join(', ') || '(none)'}.`,
    );
  }
}

/** 수입 시점(2026-08-23) SHA-256. ⛔ 갱신 전에 NOTICE.md §3 을 먼저 고친다. */
const VENDORED: Readonly<Record<string, string>> = {
  'LICENSE': '9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da',
  'anti-ai-slop.md': 'd0f57d3064451663f9dca81af170fc754acc4b1e77280fd5cfb3a04afeef9a5c',
  'accessibility-baseline.md': 'ef6c5f670d114ceb4c347681bcf3be8637e5d1186165a9c79ca265f316c72d11',
  // 2차 수입(2026-08-23) — 대표 결정 「ⓐ 소비: 규칙서를 elanous 안으로」로 나머지 아홉을 들여왔다.
  'animation-discipline.md': '075273e8404f7931adfe196d508461efdd303b54e0d9a9ef3f642a682c12a760',
  'color.md': 'fb45b59fa3055f13d6549f45ae52e88cd09d3facd0e5aaab63600e7fb024db6d',
  'form-validation.md': 'a31410ce6ba8b7a762c2975386f2e93ae97b59a8bc85169aa58457927b0a88e6',
  'laws-of-ux.md': '9a4db0fe294a240920921111d43a6af5ea0c4df1bf979f6e780610a36a9c6d1c',
  'rtl-and-bidi.md': '713abc3707eb056ed1d40ca8f3e91c04afc4003251b9ed266650fd267cbf4391',
  'state-coverage.md': '79bda732b55b0f0e4a366ba934f4a01518d3576091422047690e269222f2b682',
  'typography-hierarchy-editorial.md': 'df5beddb8cd3c2b8f15e74f57ada607f7a89ce9112aaa8f8fad22d89e452bea4',
  'typography-hierarchy.md': 'e247ca0358dcbdc3921f2148cc44c6ddcc325429b8082f6ad033792b79e39e06',
  'typography.md': '5f8e634b35c6b27a5e86f748825da17efe6a0d2e96f68dc35f57f406420049a6',
};

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('vendored craft rulesets stay byte-identical', () => {
  // ⭐ 분모를 먼저 못 박는다 — 목록이 비면 「전부 통과」가 아니라 «측정 안 함»이다.
  test('guards a non-empty vendored file set', () => {
    expect(Object.keys(VENDORED).length).toBeGreaterThan(0);
  });

  for (const [name, expected] of Object.entries(VENDORED)) {
    test(`${name} matches its recorded import hash`, () => {
      expect(sha256(join(CRAFT_DIR, name))).toBe(expected);
    });
  }
});

describe('vendored craft files are registered and noticed', () => {
  test('excludes locally-authored NOTICE.md from vendored registration candidates', () => {
    expect(deriveVendoredCraftFileNames(['new-rule.md', 'NOTICE.md', 'LICENSE'])).toEqual(['new-rule.md', 'LICENSE']);
  });

  test('identifies an added directory file missing from the checksum table and NOTICE', () => {
    const candidates = deriveVendoredCraftFileNames(['existing-rule.md', 'unregistered-rule.md', 'NOTICE.md']);
    expect(() => assertVendoredCraftFilesRegistered(candidates, { 'existing-rule.md': 'checksum' }))
      .toThrow('unregistered checksum-table files: unregistered-rule.md');
    expect(() => assertNoticeRecordsVendoredFiles(candidates, 'f'.repeat(64) + '  existing-rule.md'))
      .toThrow('Vendored craft files missing from NOTICE: unregistered-rule.md');
  });

  test('requires exact NOTICE checksum-table entries rather than explanatory or similarly named text', () => {
    const candidates = ['new-rule.md'];
    const notice = [
      'new-rule.md is pending provenance review.',
      `${'f'.repeat(64)}  new-rule.md.bak`,
    ].join('\n');
    expect(() => assertNoticeRecordsVendoredFiles(candidates, notice))
      .toThrow('Vendored craft files missing from NOTICE: new-rule.md');
  });

  test('registers every directory-derived vendored file and records it in NOTICE', () => {
    const candidates = deriveVendoredCraftFileNames(readdirSync(CRAFT_DIR));
    const notice = readFileSync(join(CRAFT_DIR, 'NOTICE.md'), 'utf8');
    expect(() => assertVendoredCraftFilesRegistered(candidates, VENDORED)).not.toThrow();
    expect(() => assertNoticeRecordsVendoredFiles(candidates, notice)).not.toThrow();
  });
});

describe('scaffolded Craft rulebooks match the vendored directory', () => {
  test('derives only markdown rulebooks, excluding NOTICE and LICENSE', () => {
    expect(deriveCraftRulebookNames(['new-rule.md', 'NOTICE.md', 'LICENSE', 'notes.txt'])).toEqual(['new-rule']);
  });

  test('identifies an added directory rulebook missing from a declaration', () => {
    expect(() => assertCraftRulebookNamesMatch(['existing-rule', 'added-rule'], ['existing-rule'], 'root DESIGN.md'))
      .toThrow('missing from root DESIGN.md: added-rule');
  });

  test('identifies a removed directory rulebook still declared by a declaration', () => {
    expect(() => assertCraftRulebookNamesMatch(['existing-rule'], ['existing-rule', 'removed-rule'], 'root DESIGN.md'))
      .toThrow('unavailable from directory: removed-rule');
  });

  test('matches the current directory-derived rules against root DESIGN.md', () => {
    const directoryNames = deriveCraftRulebookNames(readdirSync(CRAFT_DIR));
    const rootNames = extractCraftRulebookNames(readFileSync(ROOT_DESIGN_DOCUMENT, 'utf8'));
    expect(() => assertCraftRulebookNamesMatch(directoryNames, rootNames, 'root DESIGN.md')).not.toThrow();
  });

  test('matches root DESIGN.md declarations against the scaffold seed', () => {
    const rootNames = extractCraftRulebookNames(readFileSync(ROOT_DESIGN_DOCUMENT, 'utf8'));
    const scaffoldNames = extractScaffoldCraftRulebookNames(readFileSync(PROJECT_SCAFFOLD, 'utf8'));
    expect(rootNames).toEqual(scaffoldNames);
  });

  // 🪞⭐ 2026-08-25 회귀 — 이 지킴이가 «절»로 끊지 않으면 `DESIGN.md` 가 새 절을
  //   가지는 순간 그 절의 항목을 «규칙집 이름»으로 오인한다(실측: 2 fail).
  //   ⛔ 그래서 「방향 절이 있어도 규칙집만 뽑는다」를 여기서 «문다» —
  //   ⭐ 이것이 없으면 다음 사람이 사설 loop 로 되돌려도 아무도 모른다.
  test('⭐ 다른 절(Design direction)이 있어도 규칙집 이름만 뽑는다 — 절로 끊는다', () => {
    const document = [
      '# Design',
      '',
      '## Craft rulebooks',
      '',
      '- color',
      '- typography',
      '',
      '## Design direction',
      '',
      '- elanous-pastel-default',
      '',
    ].join('\n');

    expect(extractCraftRulebookNames(document)).toEqual(['color', 'typography']);
  });
});

describe('license obligations survive in the vendored text', () => {
  test('LICENSE is the Apache-2.0 full text', () => {
    const license = readFileSync(join(CRAFT_DIR, 'LICENSE'), 'utf8');
    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0, January 2004');
  });

  // ⛔ Apache-2.0 «밖»의 의무다 — anti-ai-slop 은 refero_skill(MIT) 각색본이라
  //   이 줄을 지우면 다른 라이선스를 어긴다.
  test('anti-ai-slop keeps its refero_skill (MIT) attribution line', () => {
    const text = readFileSync(join(CRAFT_DIR, 'anti-ai-slop.md'), 'utf8');
    expect(text).toContain('Adapted from [refero_skill](https://github.com/referodesign/refero_skill)');
  });

  test('NOTICE checksum table records the same file set this test guards', () => {
    const notice = readFileSync(join(CRAFT_DIR, 'NOTICE.md'), 'utf8');
    expect(extractNoticeChecksumFileNames(notice)).toEqual(Object.keys(VENDORED));
    // 해시도 NOTICE 에 적혀 있어야 한다 — 문서와 기계가 «같은 값»을 들고 있는지.
    for (const hash of Object.values(VENDORED)) expect(notice).toContain(hash);
  });
});
