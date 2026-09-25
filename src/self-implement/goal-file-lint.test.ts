import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  formatGoalFileLintFinding,
  GOAL_FILE_LINT_ORIGINS,
  lintGoalFile,
  planGateSignals,
  type GoalFileLintResult,
  type GoalFileLintLevel,
  type GoalFileLintTag,
} from './goal-author.js';

type IsOptional<T, Key extends keyof T> = {} extends Pick<T, Key> ? true : false;
const knownOriginTagCountIsOptional: IsOptional<GoalFileLintResult, 'knownOriginTagCount'> = true;

const canonicalGoal = (scopeBoundary = 'short boundary') => `## PROBLEM
problem

## WHAT TO BUILD
build

## ACCEPTANCE CRITERIA
criteria

## REQUIRED EVIDENCE
- [criterion-1] evidence for the criterion above

## TRACED PATHS
paths

## SCOPE BOUNDARY
${scopeBoundary}

## 답하지 못하는 것
none

## 불변식
keep

## 판정 신호
signals

## REQUIRED EVIDENCE
- [proof] a checkable result
`;
const evidence = '## REQUIRED EVIDENCE\n- [proof] a checkable result\n';

function rendered(document: string, branch = 'main'): string[] {
  return lintGoalFile(document, branch).map(formatGoalFileLintFinding);
}

function expectedRenderedFinding(level: GoalFileLintLevel, tag: GoalFileLintTag, message: string): string {
  const origin = GOAL_FILE_LINT_ORIGINS[tag];
  const renderedOrigin = origin.kind === 'known-incident'
    ? `${origin.incident} (reference: ${origin.reference})`
    : origin.label;
  return `${level} [${tag}] ${message} — origin: ${renderedOrigin}`;
}

const knownIncidentOriginTagCount = Object.values(GOAL_FILE_LINT_ORIGINS)
  .filter((origin) => origin.kind === 'known-incident').length;

describe('goal file lint', () => {
  test('declares known-origin tag observation as optional and connects its execution value', () => {
    const findings = lintGoalFile(evidence, 'main');

    expect(knownOriginTagCountIsOptional).toBe(true);
    expect(findings.knownOriginTagCount).toBe(knownIncidentOriginTagCount);
    expect(Object.getOwnPropertyDescriptor(findings, 'knownOriginTagCount')?.enumerable).toBe(false);
  });

  test('reports ERROR for absent or empty required evidence and exits through the caller-visible level', () => {
    for (const document of ['## PROBLEM\nmissing\n', '## REQUIRED EVIDENCE\n- plain item\n']) {
      const findings = lintGoalFile(document, 'main');
      expect(findings.some((finding) => finding.level === 'ERROR' && finding.tag === 'evidence-section')).toBe(true);
      // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
      expect(rendered(document)).toContain(expectedRenderedFinding('ERROR', 'evidence-section', '## REQUIRED EVIDENCE must contain at least one - [tag] description entry'));
    }
  });

  test('warns for each optional missing section while accepting the three content-contract sections', () => {
    const document = `## PROBLEM
problem

## WHAT TO BUILD
build

## ACCEPTANCE CRITERIA
criteria

## REQUIRED EVIDENCE
- [proof] a checkable result

## TRACED PATHS
paths

## SCOPE BOUNDARY
boundary

## 답하지 못하는 것
none

## 불변식
keep

## 판정 신호
signals
`;
    const findings = lintGoalFile(document, 'main');
    const optionalFindings = lintGoalFile(`## PROBLEM
problem

## WHAT TO BUILD
build

## ACCEPTANCE CRITERIA
criteria

## REQUIRED EVIDENCE
- [proof] a checkable result
`, 'main');

    expect(findings).not.toContainEqual(expect.objectContaining({ level: 'ERROR' }));
    for (const heading of ['## TRACED PATHS', '## SCOPE BOUNDARY', '## 답하지 못하는 것', '## 불변식', '## 판정 신호']) {
      expect(optionalFindings).toContainEqual({ level: 'WARN', tag: 'canonical-structure', message: `missing required section: ${heading}` });
    }
    for (const heading of ['## PROBLEM', '## ACCEPTANCE CRITERIA', '## REQUIRED EVIDENCE']) {
      expect(findings).not.toContainEqual(expect.objectContaining({ level: 'ERROR', tag: 'canonical-structure', message: `missing required section: ${heading}` }));
    }
  });

  test('allows canonical relative order after an optional section is omitted', () => {
    const document = canonicalGoal().replace('## WHAT TO BUILD\nbuild\n\n', '');
    const findings = lintGoalFile(document, 'main');

    expect(findings).toContainEqual({ level: 'WARN', tag: 'canonical-structure', message: 'missing required section: ## WHAT TO BUILD' });
    expect(findings).not.toContainEqual(expect.objectContaining({ level: 'ERROR', tag: 'canonical-structure', message: expect.stringContaining('required sections must appear in order:') }));
  });

  test('accepts only a non-empty tag and description in the required-evidence section outside code fences', () => {
    expect(rendered(evidence)).not.toContainEqual(expect.stringContaining('[evidence-section]'));
    for (const invalidEntry of ['- plain item', '- [ ] description', '- [proof]   ', '- [ ]   ']) {
      expect(rendered(`## REQUIRED EVIDENCE\n${invalidEntry}\n`)).toContainEqual(expect.stringContaining('[evidence-section]'));
    }
    expect(rendered('## REQUIRED EVIDENCE\n- plain item\n\n## PROBLEM\n- [other] ignored\n')).toContainEqual(expect.stringContaining('[evidence-section]'));
    expect(rendered('## REQUIRED EVIDENCE\n```md\n- [proof] ignored code\n```\n')).toContainEqual(expect.stringContaining('[evidence-section]'));
  });

  // ⛔⭐⭐⭐ `METHOD v8` 이 스스로 넣는 정보 줄이 «같은 절의» 린터에 막혀 발사가 거부됐다
  //   (2026-08-03 · `[T]` 실물 · `GOAL-T24`). 방법론을 «따른» 골만 못 뜨는 역설이었다.
  //   ⇒ 저작기가 넣는 주석 줄은 태그 계약의 대상이 아니다. 저자가 고칠 수 없는 줄이기 때문이다.
  test('exempts the authored - Information: annotation from the required-evidence tag contract', () => {
    const informationLine = '- Information: acceptance-criterion evidence kinds: default 28, test 1, log 3.';
    const withAnnotation = `## REQUIRED EVIDENCE\n- [proof] a checkable result\n${informationLine}\n`;

    expect(rendered(withAnnotation)).not.toContainEqual(expect.stringContaining('[evidence-section]'));

    // ⭐ 반증 — 면제는 «그 접두에만» 걸린다. 접두를 바꾸면 다시 물어야 한다.
    const notAnnotation = `## REQUIRED EVIDENCE\n- [proof] a checkable result\n- Informational: same shape without the exact prefix\n`;
    expect(rendered(notAnnotation)).toContainEqual(expect.stringContaining('[evidence-section]'));

    // ⭐ 반증 — 주석만 있고 태그 항목이 하나도 없으면 여전히 ERROR 다(면제가 절 전체를 비우지 않는다).
    // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
    expect(rendered(`## REQUIRED EVIDENCE\n${informationLine}\n`))
      .toContain(expectedRenderedFinding('ERROR', 'evidence-section', '## REQUIRED EVIDENCE must contain at least one - [tag] description entry'));
  });

  test('flags a mix of a valid tagged entry and an untagged entry rather than passing on existence', () => {
    const mixed = '## REQUIRED EVIDENCE\n- [proof] a checkable result\n- plain untagged item\n';
    const findings = lintGoalFile(mixed, 'main');
    expect(findings.some((finding) => finding.level === 'ERROR' && finding.tag === 'evidence-section')).toBe(true);
    // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
    expect(rendered(mixed)).toContain(expectedRenderedFinding('ERROR', 'evidence-section', '## REQUIRED EVIDENCE has entries missing a - [tag] description: - plain untagged item'));
    // A section whose every list item is tagged emits no evidence-section finding.
    expect(rendered('## REQUIRED EVIDENCE\n- [proof] one\n- [tsc] two\n')).not.toContainEqual(expect.stringContaining('[evidence-section]'));
  });

  test('reports candidate advisory independently while measuring only selected boundary decisions', () => {
    const candidateBody = `- ${'c'.repeat(2_000)}`;
    const candidates = [
      '- Scope-boundary candidates selected by document relevance:',
      '- 1 scope-boundary candidate(s) were selected by document relevance; their identifiers are retained in the `scope-boundary-candidates` observation.',
      candidateBody,
      '- If adopted, state each boundary as an intentional goal decision with its reason; do not create a must-fix solely from that boundary.',
    ].join('\n');
    const belowLimit = canonicalGoal(candidates);
    const aboveLimit = canonicalGoal(`${candidates}\n- Boundary decision: ${'x'.repeat(1_801)}`);

    // Origin enrichment broke these assertions before; origins remain incrementally populated, so derive only their suffixes from the canonical constant.
    expect(rendered(belowLimit)).toContain(expectedRenderedFinding('WARN', 'boundary-size', '## SCOPE BOUNDARY contains unselected scope-boundary candidates; select decisions before evaluating boundary size'));
    expect(rendered(belowLimit)).not.toContain(expectedRenderedFinding('WARN', 'boundary-size', '## SCOPE BOUNDARY exceeds 1800 characters'));
    expect(rendered(aboveLimit)).not.toContain(expectedRenderedFinding('WARN', 'boundary-size', '## SCOPE BOUNDARY contains unselected scope-boundary candidates; select decisions before evaluating boundary size'));
    expect(rendered(aboveLimit)).toContain(expectedRenderedFinding('WARN', 'boundary-size', '## SCOPE BOUNDARY exceeds 1800 characters'));
    expect(rendered(canonicalGoal(candidateBody))).toContain(expectedRenderedFinding('WARN', 'boundary-size', '## SCOPE BOUNDARY exceeds 1800 characters'));
    expect(rendered(canonicalGoal('x'.repeat(100)))).toEqual([]);
  });

  test('warns with the count and IDs of DEFERRED-UNTIL-prefix clarifications without changing valid-goal findings', () => {
    const deferred = `${canonicalGoal()}\n- Clarification:\n  - id: deployment-owner\n  - header: Clarification\n  - question: Who owns deployment?\n  - answer: DEFERRED-UNTIL: Who owns deployment?\n\n- Clarification:\n  - id: rollout-window\n  - header: Clarification\n  - question: When is rollout?\n  - answer: DEFERRED-UNTIL When is rollout?\n`;
    const answered = deferred.replaceAll('DEFERRED-UNTIL: Who owns deployment?', 'platform').replaceAll('DEFERRED-UNTIL When is rollout?', 'Monday');
    const nonDeferred = deferred.replaceAll('DEFERRED-UNTIL: Who owns deployment?', 'ANSWERED-DEFERRED-UNTIL: Who owns deployment?').replaceAll('DEFERRED-UNTIL When is rollout?', 'Monday');

    // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
    expect(rendered(deferred)).toContain(expectedRenderedFinding('WARN', 'unanswered-clarification', '2 unanswered clarifications: deployment-owner { question="Who owns deployment?"; questionTruncated=false; options=none; optionsTruncated=false }, rollout-window { question="When is rollout?"; questionTruncated=false; options=none; optionsTruncated=false }'));
    expect(rendered(answered)).not.toContainEqual(expect.stringContaining('[unanswered-clarification]'));
    expect(rendered(nonDeferred)).not.toContainEqual(expect.stringContaining('[unanswered-clarification]'));
    expect(rendered(canonicalGoal())).not.toContainEqual(expect.stringContaining('[unanswered-clarification]'));
  });

  test('warns for non-main branches and distinguishes forty shell-damage cases', () => {
    // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
    expect(rendered(evidence, 'feat/goal-lint')).toContain(expectedRenderedFinding('WARN', 'launch-branch', 'current branch is feat/goal-lint, not main'));
    expect(rendered(evidence, 'main')).not.toContainEqual(expect.stringContaining('[launch-branch]'));
    const shellDamage = (document: string) => rendered(`${evidence}\n${document}`).some((finding) => finding.includes('[shell-damage]'));
    const cases = [
      { name: 'unclosed empty double-backtick damage', document: 'text with `` damaged reference', expected: true },
      { name: 'matching empty double-backtick span', document: 'text with ``   `` damaged reference', expected: true },
      { name: 'non-empty single-backtick inline code', document: 'text with `code`', expected: false },
      { name: 'line-start fenced code', document: '```\nverbatim `` in an authored ask\n```', expected: false },
      { name: 'tilde fenced code', document: '~~~\nverbatim `` in an authored ask\n~~~', expected: false },
      // ⚠️ 닫는 펜스는 뒤가 공백뿐이어야 한다(CommonMark) — 초판은 `` ``` suffix `` 를 닫힘으로 봤는데
      //   그것은 info 문자열이 붙은 **여는 펜스**이지 닫힘이 아니다(리뷰 must-fix).
      { name: 'folded mid-line fenced code', document: 'prefix ```\nverbatim `` in an authored ask\n```', expected: false },
      { name: 'non-empty CommonMark double-backtick inline code with intermediate backtick run', document: 'text with ``foo`bar``', expected: false },
      // ⚠️ 앞 픽스처가 목록으로 끝나므로 **문단을 하나 두어** 최상위 들여쓴 코드블록임을 분명히 한다 —
      //   목록 항목 바로 뒤의 들여쓴 줄은 CommonMark 상 **그 항목의 내용**이지 코드블록이 아니다.
      { name: 'four-space-indented code block', document: 'paragraph\n\n    verbatim `` in an authored ask', expected: false },
      // ⛔ 리뷰 must-fix — 요청된 케이스는 '닫는 펜스가 없는' 줄 중간 세 백틱인데 초판은 닫는 펜스가
      //   있는 다중행 사례를 넣어 실제 회귀를 숨겼다. 짝 없는 런은 코드 스팬이 아니므로 안 걸린다.
      { name: 'folded mid-line fence with no closing fence anywhere', document: 'text that folded ``` and continued', expected: false },
      // 반증 입력 — 혼합 마커는 펜스가 아니다. 펜스로 인정하면 그 안의 진양성이 숨는다.
      { name: 'mixed-marker run is not a fence, so damage inside still fires', document: '``~\nverbatim `` in an authored ask\n``~', expected: true },
      // 반증 입력 — 백틱 펜스의 info 문자열에 백틱이 있으면 CommonMark 상 펜스가 아니다.
      //   펜스로 인정하면 같은 줄의 진양성이 숨는다(리뷰 must-fix).
      { name: 'backtick fence with a backtick in its info string is not a fence', document: '``` info`with`ticks `` damage', expected: true },
      // 대조군 — 틸드 펜스는 info 에 백틱을 허용하므로 그 안은 코드다.
      { name: 'tilde fence permits backticks in its info string', document: '~~~ info`with`ticks\nverbatim `` in an authored ask\n~~~', expected: false },
      // 반증 입력 — 닫힘 후보에 info 문자열이 붙으면 그것은 여는 펜스다. 닫힘으로 오인하면 사이의 진양성이 숨는다.
      { name: 'a closing candidate carrying an info string does not close a folded fence', document: 'prefix ```\ndamage `` here\n``` lang', expected: true },
      // 반증 입력 — 들여쓴 코드블록은 단락을 중단하지 못한다. 무조건 제외하면 이 줄의 진양성이 숨는다.
      { name: 'an indented line cannot interrupt a paragraph, so damage there still fires', document: 'text\n    damage ``', expected: true },
      // 반증 입력 — 탭 들여쓰기도 코드블록이다(열 기준: 공백 셋 + 탭 = 4열).
      { name: 'a tab-indented code block at the document start is code', document: '   \tverbatim `` in an authored ask', expected: false },
      // 반증 입력 — 제목 뒤·펜스 뒤의 들여쓴 줄은 단락 이어짐이 아니라 코드블록이다.
      { name: 'an indented block after a heading is code, not a paragraph continuation', document: '## Heading\n    verbatim `` in an authored ask', expected: false },
      { name: 'an indented block after a closed fence is code', document: '```\ncode\n```\n    verbatim `` in an authored ask', expected: false },
      // 반증 입력 — 인라인 스팬은 빈 줄을 넘지 못한다. 문서 전체를 한 문맥으로 묶으면 두 단락의
      //   짝 없는 런이 짝지어져 진양성이 숨는다.
      { name: 'runs in different paragraphs do not pair into one code span', document: 'first `` damage\n\nsecond `` damage', expected: true },
      // 반증 입력 — thematic break 는 단락이 아니므로 그 뒤의 들여쓴 줄은 코드블록이다.
      { name: 'an indented block after a thematic break is code', document: '---\n    verbatim `` in an authored ask', expected: false },
      // 반증 입력 — 블록 경계는 빈 줄만이 아니다. 제목·펜스·들여쓴 코드가 사이에 있어도
      //   양쪽의 짝 없는 런은 짝지어지지 않는다(리뷰 must-fix).
      { name: 'runs separated by a heading do not pair', document: 'first `` damage\n## Heading\nsecond `` damage', expected: true },
      { name: 'runs separated by a fenced block do not pair', document: 'first `` damage\n```\ncode\n```\nsecond `` damage', expected: true },
      { name: 'runs separated by an indented code block do not pair', document: 'first `` damage\n\n    indented code\n\nsecond `` damage', expected: true },
      // 반증 입력 — 제목 **줄 자체**에 짝 없는 런이 있어도 뒤 단락과 짝지어지면 안 된다(리뷰 must-fix).
      { name: 'an ATX heading is its own block and does not pair with the next paragraph', document: '## title `` damage\nbody `` damage', expected: true },
      { name: 'a setext underline closes the paragraph above it', document: 'title `` damage\n===\nbody `` damage', expected: true },
      // 반증 입력 — block quote 는 컨테이너다. 안팎의 런이 짝지어지면 진양성이 숨는다(리뷰 must-fix).
      { name: 'runs separated by a block quote do not pair', document: 'first `` damage\n> quote\nsecond `` damage', expected: true },
      // 대조군 — 인용 안의 유효한 펜스는 코드다. 마커를 벗겨 재귀로 보면 인정된다.
      { name: 'a fenced block inside a quote is code', document: '> ~~~\n> verbatim `` in an authored ask\n> ~~~', expected: false },
      // 진양성 — 인용 **안**의 손상은 여전히 걸린다(인용을 통째로 건너뛰지 않는다).
      { name: 'damage inside a quote still fires', document: '> quoted `` damage', expected: true },
      // 반증 입력 — 인용 안 단락은 `>` 없는 다음 줄로 이어진다(lazy continuation). 그 줄을 빼면
      //   여러 줄에 걸친 정상 코드 스팬이 갈려 오탐이 난다(리뷰 must-fix).
      { name: 'a lazy continuation stays inside the quote so a multi-line span is not split', document: '> ``foo\nbar``', expected: false },
      // 반증 입력 — 골 문서는 목록투성이다(증거 태그·TRACED PATHS). 항목마다 남은 짝 없는 런이
      //   짝지어지면 진양성이 통째로 숨는다(리뷰 must-fix).
      { name: 'runs in different list items do not pair', document: '- first `` damage\n- second `` damage', expected: true },
      { name: 'runs in different ordered list items do not pair', document: '1. first `` damage\n2. second `` damage', expected: true },
      // 반증 입력 — 목록 항목 **안의 들여쓴 펜스**는 코드다. 실측으로 골 문서 343개 중 7건 있다.
      { name: 'a fenced block indented inside a list item is code', document: '123. item\n     ```\n     verbatim `` in an authored ask\n     ```', expected: false },
      { name: 'damage inside a list item still fires', document: '- item with `` damage', expected: true },
      // 반증 입력 — 항목 안 단락도 들여쓰기 없는 다음 줄로 이어진다(lazy continuation · 인용문과 같은 형태).
      { name: 'a lazy continuation stays inside the list item so a multi-line span is not split', document: '- ``foo\nbar``', expected: false },
      // 반증 입력 — 1 이 아닌 순서 목록은 단락을 중단하지 못한다(CommonMark). 가르면 정상 스팬이 갈린다.
      { name: 'an ordered marker other than 1 cannot interrupt a paragraph', document: 'text ``foo\n2. bar``', expected: false },
      // 대조군 — 1 로 시작하는 순서 목록은 단락을 중단한다.
      { name: 'an ordered list starting at 1 does interrupt a paragraph', document: 'text `` damage\n1. item `` damage', expected: true },
      // 반증 입력 — 빈 목록 항목도 단락을 중단하지 못한다(CommonMark).
      { name: 'an empty bullet cannot interrupt a paragraph', document: 'text ``foo\n*\nbar``', expected: false },
      { name: 'an empty ordered item cannot interrupt a paragraph', document: 'text ``foo\n1.\nbar``', expected: false },
      // ⚠️ 대조군 — 단락 뒤의 `-` 는 **빈 목록 항목이 아니라 setext 제목 밑줄**이다(CommonMark).
      //   그래서 블록이 갈리고 짝 없는 런 둘이 남는다 — 발화가 옳다.
      { name: 'a lone dash after a paragraph is a setext underline, not an empty bullet', document: 'text ``foo\n-\nbar``', expected: true },
      // 반증 입력 — 마커 뒤 공백이 5칸 이상이면 내용은 한 칸 뒤에서 시작하고 나머지는 항목 안
      //   들여쓴 코드블록이다(CommonMark). 전부 먹으면 그 코드가 본문으로 검사돼 오탐이 난다.
      { name: 'padding beyond four spaces starts an indented code block inside the item', document: '-     verbatim `` in an authored ask', expected: false },
      // 대조군 — 네 칸까지는 그냥 내용이다.
      { name: 'padding up to four spaces is plain item content', document: '-    item with `` damage', expected: true },
      // ⛔ 혼합 런의 **동종 suffix** 를 folded 펜스로 세면 그 뒤 진양성이 통째로 숨는다. 줄머리 경로는
      //   이미 혼합을 거부하는데 folded 경로만 빠져 있었다(리뷰 must-fix · 같은 선을 두 번 맞았다).
      { name: 'a mixed marker run is not a folded fence and does not hide the damage after it', document: 'prefix ~```\ndamage ``\n```', expected: true },
      // 대조군 — 같은 자리에 **동종** 런이면 folded 펜스가 맞고, 그 안의 백틱은 발화하지 않는다.
      { name: 'a homogeneous folded fence still swallows its own body', document: 'prefix ```\nverbatim `` inside\n```', expected: false },
    ];
    expect(cases).toHaveLength(42);
    for (const scenario of cases) expect(shellDamage(scenario.document), scenario.name).toBe(scenario.expected);
  });

  test('preserves shell damage beside unmatched and folded mid-line fences without altering shared markdown parsing', () => {
    const shellDamage = (document: string) => rendered(`${evidence}\n${document}`).some((finding) => finding.includes('[shell-damage]'));
    expect(shellDamage('text `` damage ' + '```')).toBe(true);
    expect(shellDamage('prefix `` `` ' + '```\nverbatim `` in an authored ask\n``` suffix `` ``')).toBe(true);
    expect(shellDamage('prefix ```\nverbatim foo ``` bar\n```\nfence outside `` `` damage')).toBe(true);
    // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
    expect(rendered(canonicalGoal(`    ${'x'.repeat(1801)}`))).toContain(expectedRenderedFinding('WARN', 'boundary-size', '## SCOPE BOUNDARY exceeds 1800 characters'));
  });

  test('reports missing traced paths and invalid lines only through the injected reader', () => {
    const document = canonicalGoal('short boundary').replace(
      '## TRACED PATHS\npaths',
      '## TRACED PATHS\n- src/missing.ts — absent\n* src/with space.ts:4 — too late\n+ src/with space.ts:3 — present\n1. src/with space.ts:0 — invalid\n2) src/also-present.ts:1 — present\n- README.md — root present\n* missing-root.md — root absent\n+ src/empty.ts:1 — empty file\n- LICENSE — root present\n* Makefile — root present\n+ .gitignore — root present\n- missing-root — root absent\n- src/also-present.ts — see src/explanation-only.ts',
    );
    const readReferencedFile = (path: string): string | null => ({
      'src/with space.ts': 'one\ntwo\nthree',
      'src/also-present.ts': 'one',
      'README.md': 'root',
      'src/empty.ts': '',
      LICENSE: 'license',
      Makefile: 'all:',
      '.gitignore': 'node_modules',
    })[path] ?? null;

    expect(rendered(document)).not.toContainEqual(expect.stringContaining('[traced-path]'));
    const findings = lintGoalFile(document, 'main', { readReferencedFile });
    expect(findings).toEqual(expect.arrayContaining([
      { level: 'ERROR', tag: 'traced-path', message: 'traced path does not exist: src/missing.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 4 is out of range: src/with space.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 0 is out of range: src/with space.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path does not exist: missing-root.md' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path does not exist: missing-root' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 1 is out of range: src/empty.ts' },
    ]));
    for (const path of ['src/with space.ts:3', 'src/also-present.ts', 'README.md', 'LICENSE', 'Makefile', '.gitignore', 'src/explanation-only.ts']) {
      const [filePath] = path.split(':');
      expect(findings.some((finding) => finding.tag === 'traced-path' && finding.message.includes(filePath) && (path === filePath || finding.message.includes(path)))).toBe(false);
    }
  });

  // 리뷰 must-fix(#6423) — 픽스처가 전부 개행 없이 끝나서 실제 파일(개행 종료)의 마지막+1 줄이 통과했다.
  test('distinguishes missing, unreadable, and outside-repository traced paths', () => {
    const document = canonicalGoal().replace(
      '## TRACED PATHS\npaths',
      '## TRACED PATHS\n- src/missing.ts — absent\n- src/unreadable.ts — read failure\n- ../outside.ts — boundary escape\n- src/present.ts:2 — out of range',
    );
    const findings = lintGoalFile(document, 'main', {
      readReferencedFile: (path) => {
        switch (path) {
          case 'src/missing.ts': return { kind: 'missing' } as const;
          case 'src/unreadable.ts': return { kind: 'read-error' } as const;
          case '../outside.ts': return { kind: 'outside-repository' } as const;
          case 'src/present.ts': return { kind: 'ok', contents: 'one' } as const;
          default: return { kind: 'missing' } as const;
        }
      },
    });

    expect(findings).toEqual(expect.arrayContaining([
      { level: 'ERROR', tag: 'traced-path', message: 'traced path does not exist: src/missing.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path could not be read: src/unreadable.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path is outside repository: ../outside.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 2 is out of range: src/present.ts' },
    ]));
  });

  test('a terminating newline closes the last line instead of opening one more', () => {
    const document = canonicalGoal('short boundary').replace(
      '## TRACED PATHS\npaths',
      '## TRACED PATHS\n- src/lf.ts:1 — last real line\n- src/lf.ts:2 — past the end\n- src/crlf.ts:1 — last real line\n- src/crlf.ts:2 — past the end\n- src/newline-only.ts:1 — the one empty line\n- src/newline-only.ts:2 — past the end\n- src/no-bytes.ts:1 — an empty file has no line',
    );
    const readReferencedFile = (path: string): string | null => ({
      'src/lf.ts': 'one\n',
      'src/crlf.ts': 'one\r\n',
      'src/newline-only.ts': '\n',
      'src/no-bytes.ts': '',
    })[path] ?? null;

    const findings = lintGoalFile(document, 'main', { readReferencedFile });
    expect(findings).toEqual(expect.arrayContaining([
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 2 is out of range: src/lf.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 2 is out of range: src/crlf.ts' },
      // ⛔ 개행 하나짜리 파일은 **빈 1행을 종료한 것**이라 :1 은 유효하고 :2 부터가 범위 밖이다.
      //   바이트가 아예 없는 파일과 구별된다(리뷰 2차 must-fix — 초판은 이 오판을 정답으로 고정했다).
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 2 is out of range: src/newline-only.ts' },
      { level: 'ERROR', tag: 'traced-path', message: 'traced path line 1 is out of range: src/no-bytes.ts' },
    ]));
    // 반증 입력: 실재하는 마지막 줄은 여전히 통과해야 한다(검사를 꺼서 통과시킨 것이 아님을 가른다).
    for (const path of ['src/lf.ts', 'src/crlf.ts', 'src/newline-only.ts']) {
      expect(findings).not.toContainEqual({ level: 'ERROR', tag: 'traced-path', message: `traced path line 1 is out of range: ${path}` });
    }
  });

  test('collects plan gate signals without changing lint findings or formatted output', () => {
    const document = `${canonicalGoal().replace('## TRACED PATHS\npaths', '## TRACED PATHS\n- src/missing.ts\n- ../outside.ts')}\n- Checkable requested criterion: retain telemetry registry\n- Checkable requested criterion: retain telemetry telemetry\n- Checkable preservation criterion: no telemetry registry writes\n- Checkable preservation criterion: without unrelated component mutations\n- UNVERIFIABLE: pending evidence\n- UNVERIFIABLE: pending observation\n- Clarification:\n  - id: deploy\n  - header: Clarification\n  - question: Who deploys?\n  - answer: DEFERRED-UNTIL: Who deploys?\n\n- Clarification:\n  - id: rollout\n  - header: Clarification\n  - question: When is rollout?\n  - answer: DEFERRED-UNTIL: When is rollout?\n`;
    const findings = lintGoalFile(document, 'main', {
      readReferencedFile: (path) => path === 'src/missing.ts'
        ? { kind: 'missing' } as const
        : path === '../outside.ts'
          ? { kind: 'outside-repository' } as const
          : { kind: 'ok', contents: 'present' } as const,
    });
    const before = [...findings];
    const formattedBefore = before.map(formatGoalFileLintFinding);

    expect(planGateSignals(document, findings)).toEqual({
      goalId: null,
      // Persistent-evidence paths are counted according to whether they match the target path.
      persistentEvidenceTargetPathCount: 0,
      persistentEvidenceOutsideTargetPathCount: 0,
      tracedPathMissing: 1,
      tracedPathOutside: 1,
      unansweredClarification: 2,
      unverifiable: 2,
      unverifiableInvariantCandidates: 0,
      normalizedMarkerSuccess: 0,
      normalizedMarkerFailure: 0,
      requestedCriteria: 2,
      contradiction: 1,
      unverifiableLines: ['- UNVERIFIABLE: pending evidence', '- UNVERIFIABLE: pending observation'],
      contradictionLines: ['- Checkable preservation criterion: no telemetry registry writes'],
    });
    expect(findings.filter((finding) => finding.tag === 'unanswered-clarification')).toHaveLength(1);
    // ⛔ `lintGoalFile` 은 배열에 `recognizedInvariantCount` 를 얹은 `GoalFileLintResult` 를 낸다(#9582).
    //   비교 대상은 «발견 목록»이므로 배열로 좁혀 둔다 — 안 좁히면 오버로드가 안 맞는다.
    expect([...findings]).toEqual([...before]);
    expect(findings.map(formatGoalFileLintFinding)).toEqual(formattedBefore);
  });

  test('counts only leading prohibition and permission symbols as non-enumerable lint metadata', () => {
    const prohibition = lintGoalFile('⛔ prohibition begins this line', 'main');
    expect(prohibition.prohibitionSymbolStartingLineCount).toBe(1);

    const permission = lintGoalFile('✅ permission begins this line', 'main');
    expect(permission.permissionSymbolStartingLineCount).toBe(1);

    const indentedProhibition = lintGoalFile('    ⛔ indentation is ignored', 'main');
    expect(indentedProhibition.prohibitionSymbolStartingLineCount).toBe(1);

    const internalProhibition = lintGoalFile('text contains ⛔ but does not start with it', 'main');
    expect(internalProhibition.prohibitionSymbolStartingLineCount).toBe(0);
    expect(internalProhibition.permissionSymbolStartingLineCount).toBe(0);
    expect(internalProhibition.mixedSymbolLineCount).toBe(0);

    const mixed = lintGoalFile('⛔ both symbols ✅ share this line', 'main');
    expect(mixed.prohibitionSymbolStartingLineCount).toBe(0);
    expect(mixed.permissionSymbolStartingLineCount).toBe(0);
    expect(mixed.mixedSymbolLineCount).toBe(1);

    const noSymbols = lintGoalFile('a line without either symbol', 'main');
    expect(noSymbols.prohibitionSymbolStartingLineCount).toBe(0);
    expect(noSymbols.permissionSymbolStartingLineCount).toBe(0);
    expect(noSymbols.mixedSymbolLineCount).toBe(0);

    expect(Object.keys(mixed)).not.toContain('prohibitionSymbolStartingLineCount');
    expect(Object.keys(mixed)).not.toContain('permissionSymbolStartingLineCount');
    expect(Object.keys(mixed)).not.toContain('mixedSymbolLineCount');
  });

  test('counts author-known shapes as non-enumerable metadata without changing findings or blocking levels', () => {
    const goal = (ask: string) => canonicalGoal().replace('build', `Original ask (verbatim, unmodified):\n\`\`\`\n${ask}\n\`\`\``);
    const matching = lintGoalFile(goal([
      '전수로 확인하고 모두 찾으며 빠짐없이 검토한다.',
      '불변식: 모든 동작을 바꾸지 않는다.',
      '불변식: `src/retained.ts`의 모든 행동을 바꾸지 않는다.',
      '불변식: `src/also-retained.ts`의 동작을 유지한다.',
      '판정 신호: 조건 = 캐시를 제거한 뒤 부른다; 관측 = 반환; 기대 = 유지된다',
    ].join('\n')), 'main');
    const nonMatching = lintGoalFile(goal([
      '필요한 항목을 확인한다.',
      '불변식: 설정을 추가한다.',
      '불변식: 경로를 연결한다.',
      '불변식: 결과를 기록한다.',
      '판정 신호: 조건 = 경로를 추가한다; 관측 = 반환; 기대 = 유지된다',
    ].join('\n')), 'main');

    expect(matching.exhaustiveRequestWordingCount).toBeGreaterThan(nonMatching.exhaustiveRequestWordingCount);
    expect(matching.blanketBehaviorPreservationCount).toBeGreaterThan(nonMatching.blanketBehaviorPreservationCount);
    expect(matching.namedPreservationTargetCount).toBeGreaterThan(nonMatching.namedPreservationTargetCount);
    expect(matching.removalFormDecisionConditionCount).toBeGreaterThan(nonMatching.removalFormDecisionConditionCount);
    expect([...matching]).toEqual([...nonMatching]);
    for (const property of ['exhaustiveRequestWordingCount', 'blanketBehaviorPreservationCount', 'namedPreservationTargetCount', 'removalFormDecisionConditionCount']) {
      expect(Object.keys(matching)).not.toContain(property);
    }
  });

  test('adds only leading GoalId metadata to plan gate signals', () => {
    const document = '# Signal identity\n- GoalId: a4e5e73a26d682a5\n\n## PROBLEM\nbody content must not be retained by the signal';

    expect(planGateSignals(document, [])).toMatchObject({ goalId: 'a4e5e73a26d682a5' });
  });

  test('counts only authored diagnostic and preservation criterion lines, exposing their evidence', () => {
    const document = [
      'Ask prose mentions UNVERIFIABLE and contradiction but is not a diagnostic.',
      '- Checkable requested criterion: retain telemetry registry',
      '- Checkable preservation criterion: no telemetry registry writes',
      '- UNVERIFIABLE: authored diagnostic',
    ].join('\n');

    expect(planGateSignals(document, [])).toMatchObject({
      unverifiable: 1,
      contradiction: 1,
      unverifiableLines: ['- UNVERIFIABLE: authored diagnostic'],
      contradictionLines: ['- Checkable preservation criterion: no telemetry registry writes'],
    });
  });

  test('falsifies contradiction detection: a matching preservation token counts once', () => {
    const document = [
      '- Checkable requested criterion: retain telemetry registry',
      '- Checkable preservation criterion: never telemetry registry writes',
    ].join('\n');

    expect(planGateSignals(document, []).contradiction).toBe(1);
  });

  test('warns for proxy metrics and runner outcomes only in decision-signal Expected result fields', () => {
    const proxyTag = 'decision-signal-proxy-expectation';
    const decisionSignal = (expectedResult: string, field = 'Expected result') => canonicalGoal().replace('signals', [
      '- Candidate decision signal:',
      '  - Condition: 두 값이 서로 다르다',
      '  - Observation: 필드가 채워진다',
      `  - ${field}: ${expectedResult}`,
    ].join('\n'));
    const proxyFindings = (document: string) => lintGoalFile(document, 'main').filter((finding) => finding.tag === proxyTag);

    for (const literal of ['두 값이 서로 다르다', '값이 바뀐다', '필드가 채워진다', '함수가 존재한다', '호출이 한 번이다']) {
      expect(proxyFindings(decisionSignal(literal))).toContainEqual(expect.objectContaining({ level: 'WARN', message: expect.stringContaining(literal) }));
    }
    for (const expectedResult of [
      '`0 fail`이며, 멈춘 골과 안 멈춘 골이 다른 값으로 갈리고 `complete`와 예산 소진은 서로 다른 이유로 재시동 대상에서 빠진다',
      '해당 동작들이 모두 검증되고 테스트 결과가 0 fail이다.',
      '입구 열셋의 registry, 세 상태의 구분, 은퇴 메타데이터를 다루는 테스트가 `0 fail`로 끝난다.',
      '0 fail이다.',
      '테스트가 통과한다.',
      'exit 0으로 끝난다.',
    ]) {
      expect(proxyFindings(decisionSignal(expectedResult))).not.toHaveLength(0);
    }
    for (const expectedResult of [
      '소스를 한 줄도 더 고치지 않았는데 그 이름이 반환값에 들어 있다.',
      '그 디렉토리에 아무것도 쓰이지 않는다.',
      '커밋 뒤 그리고 PR 생성 전에 정합이 한 번 불린다.',
      '모른다는 것이 드러나고, 지어낸 날짜가 찍히지 않는다.',
      '앞의 조건이면 참이고 뒤의 조건이면 거짓이다',
      '그 값이 최종 소비자에 도달한다',
      '두 번째 호출이 첫 번째보다 싸다',
    ]) {
      expect(proxyFindings(decisionSignal(expectedResult))).toHaveLength(0);
    }
    expect(proxyFindings(decisionSignal('0 fail이다.', 'Condition'))).toHaveLength(0);
    expect(proxyFindings(decisionSignal('0 fail이다.', 'Expected Result'))).toHaveLength(0);
    expect(proxyFindings(canonicalGoal().replace('problem', '0 fail이다.'))).toHaveLength(0);
    expect(proxyFindings(canonicalGoal().replace('## 판정 신호\nsignals\n', '- Expected result: 0 fail이다.\n'))).toHaveLength(0);
    expect(proxyFindings(decisionSignal('두 값이 서로 다르다'))).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('final-consumer delivery, comparative cost, or directional behavior'),
    }));
  });

  test('requires independent source and coverage evidence only for Arabic acceptance numbers', () => {
    const withDecisionSignal = (lines: readonly string[]) => canonicalGoal().replace('signals', lines.join('\n'));
    const numericFindings = (document: string) => lintGoalFile(document, 'main')
      .filter((finding) => finding.tag === 'decision-signal-numeric-source' || finding.tag === 'decision-signal-numeric-coverage');
    const acceptance = '- Expected result: 7 matching documents remain.';
    const cases = [
      { name: 'no number', lines: ['- Expected result: matching documents remain.'], tags: [] },
      { name: 'non-acceptance file line and command numbers', lines: ['- Observation: src/example.ts:7 is inspected.', '- Command: `bun test --retry 3`'], tags: [] },
      { name: 'labelled acceptance count', lines: ['- Expected result: Count: 7 matching documents remain.'], tags: ['decision-signal-numeric-source', 'decision-signal-numeric-coverage'] },
      { name: 'labelled acceptance documents', lines: ['- Expected result: documents: 12 remain.'], tags: ['decision-signal-numeric-source', 'decision-signal-numeric-coverage'] },
      { name: 'inline-code acceptance number', lines: ['- Expected result: output is `7`.'], tags: ['decision-signal-numeric-source', 'decision-signal-numeric-coverage'] },
      { name: 'source only', lines: [acceptance, '- 숫자 출처: corpus measurement'], tags: ['decision-signal-numeric-coverage'] },
      { name: 'coverage only', lines: [acceptance, '- 숫자 적용 범위: all matching documents'], tags: ['decision-signal-numeric-source'] },
      { name: 'both missing', lines: [acceptance], tags: ['decision-signal-numeric-source', 'decision-signal-numeric-coverage'] },
      { name: 'both satisfied', lines: [acceptance, '- 숫자 출처: corpus measurement', '- 숫자 적용 범위: all matching documents'], tags: [] },
    ] as const;

    for (const scenario of cases) {
      expect(numericFindings(withDecisionSignal(scenario.lines)).map((finding) => finding.tag).sort(), scenario.name)
        .toEqual([...scenario.tags].sort());
    }
  });

  test('preserves unrelated decision-signal findings beside numeric provenance fixtures', () => {
    const document = canonicalGoal().replace('signals', [
      '- Expected result: 0건이면 통과한다.',
      '- 숫자 출처: corpus measurement',
      '- 숫자 적용 범위: all matching documents',
    ].join('\n'));
    expect(lintGoalFile(document, 'main')).toContainEqual({
      level: 'WARN',
      tag: 'empty-result-population',
      message: '## 판정 신호 permits an empty result to pass without declaring a population',
    });
  });

  test('observes all-negative, alternative, and count decision-signal shapes as non-blocking WARN findings', () => {
    const withAskSignals = (signals: string) => canonicalGoal().replace('signals', signals);
    const shapeTags = ['all-negative-signals', 'unreadable-signals', 'alternative-signals', 'count-observation'] as const;
    const tagsOf = (document: string) => lintGoalFile(document, 'main').map((finding) => finding.tag);
    const findingFor = (document: string, tag: (typeof shapeTags)[number]) =>
      lintGoalFile(document, 'main').find((finding) => finding.tag === tag);

    const allNegative = withAskSignals([
      '판정 신호: 조건 = 인자 누락 호출; 관측 = JSON 의 allNegative; 기대 = 없다',
      '판정 신호: 조건 = 실패 칸; 관측 = 통과 여부; 기대 = 0',
      '판정 신호: 조건 = 제거된 경로; 관측 = 산출; 기대 = 사라졌다',
    ].join('\n'));
    expect(findingFor(allNegative, 'all-negative-signals')).toEqual({
      level: 'WARN',
      tag: 'all-negative-signals',
      message: '## 판정 신호 explicitly expects only absence; revise the signal to require the intended presence or persistence outcome (for example, `있다`, `여전히`, `유지`, `크다`, `이상`)',
    });
    expect(tagsOf(allNegative)).not.toContainEqual(expect.stringMatching(/^ERROR/));
    expect(findingFor(allNegative, 'all-negative-signals')?.level).toBe('WARN');

    const unreadable = withAskSignals('판정 신호: 조건 = 요청문; 관측 = 출력; 기대 = 성공이고 별명이 그 문자열이 된다');
    expect(findingFor(unreadable, 'unreadable-signals')).toEqual({
      level: 'WARN',
      tag: 'unreadable-signals',
      message: '## 판정 신호 includes expectation text this classifier cannot read; it distinguishes absence (`없다`, `0`, `아니다`, `사라졌다`) and presence/persistence (`있다`, `여전히`, `유지`, `크다`, `이상`) vocabulary. If the sentence is already correct, do not insert this vocabulary; report the classifier limitation instead.',
    });
    expect(findingFor(unreadable, 'all-negative-signals')).toBeUndefined();
    expect(findingFor(unreadable, 'unreadable-signals')?.level).toBe('WARN');

    const zeroWithUnreadable = withAskSignals([
      '판정 신호: 조건 = 종료; 관측 = 종료 코드; 기대 = 0',
      '판정 신호: 조건 = 요청문; 관측 = 출력; 기대 = 성공이고 별명이 그 문자열이 된다',
    ].join('\n'));
    expect(findingFor(zeroWithUnreadable, 'unreadable-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(zeroWithUnreadable, 'all-negative-signals')).toBeUndefined();

    const exitCodeZero = withAskSignals('판정 신호: 조건 = 명령을 실행한다; 관측 = 종료 코드; 기대 = 종료 코드가 0 이다');
    const exitCodeZeroIsNot = withAskSignals('판정 신호: 조건 = 명령을 실행한다; 관측 = 종료 코드; 기대 = 종료 코드가 0이 아니다');
    const repeatedExitCodeZero = withAskSignals('판정 신호: 조건 = 명령을 실행한다; 관측 = 종료 코드; 기대 = 종료 코드가 0 이다. 재시도 종료 코드는 0이다');
    const valueZero = withAskSignals('판정 신호: 조건 = 명령을 실행한다; 관측 = 반환값; 기대 = 값은 0이다');
    const returnedZero = withAskSignals('판정 신호: 조건 = 명령을 실행한다; 관측 = 반환값; 기대 = 0을 반환한다');
    const zeroCount = withAskSignals('판정 신호: 조건 = 조회를 실행한다; 관측 = 결과; 기대 = 결과가 0건이다');
    const resultValueZeroCount = withAskSignals('판정 신호: 조건 = 조회를 실행한다; 관측 = 결과; 기대 = 결과값이 0건이다');
    const noResults = withAskSignals('판정 신호: 조건 = 조회를 실행한다; 관측 = 결과; 기대 = 아무 결과도 없다');
    expect(findingFor(exitCodeZero, 'all-negative-signals')).toBeUndefined();
    expect(findingFor(exitCodeZero, 'unreadable-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(exitCodeZeroIsNot, 'all-negative-signals')).toBeUndefined();
    expect(findingFor(exitCodeZeroIsNot, 'unreadable-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(repeatedExitCodeZero, 'all-negative-signals')).toBeUndefined();
    expect(findingFor(repeatedExitCodeZero, 'unreadable-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(valueZero, 'all-negative-signals')).toBeUndefined();
    expect(findingFor(valueZero, 'unreadable-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(returnedZero, 'all-negative-signals')).toBeUndefined();
    expect(findingFor(returnedZero, 'unreadable-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    const exitCodeWithNoResults = withAskSignals('판정 신호: 조건 = 명령을 실행한다; 관측 = 종료 코드와 결과; 기대 = 종료 코드가 0 이다. 결과가 없다');
    expect(findingFor(exitCodeWithNoResults, 'all-negative-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(zeroCount, 'all-negative-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(resultValueZeroCount, 'all-negative-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));
    expect(findingFor(resultValueZeroCount, 'unreadable-signals')).toBeUndefined();
    expect(findingFor(noResults, 'all-negative-signals')).toEqual(expect.objectContaining({ level: 'WARN' }));

    const countObservation = withAskSignals('판정 신호: 조건 = 요청문; 관측 = 시험 «개수»; 기대 = 줄지 않는다');
    expect(findingFor(countObservation, 'count-observation')).toEqual({
      level: 'WARN',
      tag: 'count-observation',
      message: '## 판정 신호 observation measures a count rather than content',
    });

    const alternatives = withAskSignals('판정 신호: 조건 = 요청문; 관측 = 프로브 반환값; 기대 = A 거나 B 거나 C 중 하나가 있다');
    expect(findingFor(alternatives, 'alternative-signals')).toEqual({
      level: 'WARN',
      tag: 'alternative-signals',
      message: '## 판정 신호 expected result opens alternative branches',
    });

    const healthy = withAskSignals('판정 신호: 조건 = 평범한 새 경로; 관측 = 선언; 기대 = 여전히 있다');
    expect(tagsOf(healthy).filter((tag) => (shapeTags as readonly string[]).includes(tag))).toEqual([]);
    expect(tagsOf(canonicalGoal()).filter((tag) => (shapeTags as readonly string[]).includes(tag))).toEqual([]);
  });

  test('keeps unanswered-clarification and boundary-size warnings when decision-signal shape warnings are present', () => {
    const document = `${canonicalGoal('x'.repeat(1801)).replace(
      'signals',
      '판정 신호: 조건 = 인자 누락 호출; 관측 = JSON 의 allNegative; 기대 = 없다',
    )}\n- Clarification:\n  - id: deployment-owner\n  - header: Clarification\n  - question: Who owns deployment?\n  - answer: DEFERRED-UNTIL: Who owns deployment?\n`;
    const findings = lintGoalFile(document, 'main');
    expect(findings).toContainEqual(expect.objectContaining({ level: 'WARN', tag: 'boundary-size' }));
    expect(findings).toContainEqual(expect.objectContaining({ level: 'WARN', tag: 'unanswered-clarification' }));
    expect(findings).toContainEqual(expect.objectContaining({ level: 'WARN', tag: 'all-negative-signals' }));
    expect(findings.some((finding) => finding.level === 'ERROR' && (finding.tag === 'all-negative-signals' || finding.tag === 'boundary-size' || finding.tag === 'unanswered-clarification'))).toBe(false);
  });

  test('measures runner-output expected results and proxy warnings across docs/goals', () => {
    const goalDirectory = join(import.meta.dir, '../../docs/goals');
    const documents = readdirSync(goalDirectory)
      .filter((file) => file.endsWith('.md'))
      .map((file) => readFileSync(join(goalDirectory, file), 'utf8'));
    const runnerOutput = /`?0\s*fail(?:ed|ure)?s?`?|(?:테스트(?:가|는)?|tests?)\s*(?:결과(?:가|는)?\s*)?(?:모두\s*)?(?:통과|pass(?:ed)?)|(?:exit\s*(?:code\s*)?0|종료\s*코드\s*0)/i;
    const expectedResultLines = (document: string) => {
      const decisionSignal = document.match(/^## 판정 신호\s*$([\s\S]*?)(?=^## |\Z)/m)?.[1] ?? '';
      return (decisionSignal.match(/^\s*-\s*Expected result:\s*(.+)$/gm) ?? []).map((line) => line.replace(/^\s*-\s*Expected result:\s*/, ''));
    };
    const runnerOutputDocuments = documents.filter((document) => expectedResultLines(document).some((expectedResult) => runnerOutput.test(expectedResult)));
    const proxyWarningDocuments = documents.filter((document) => lintGoalFile(document, 'main').some((finding) => finding.tag === 'decision-signal-proxy-expectation'));
    console.info(`proxy expectation corpus: runner-output=${runnerOutputDocuments.length}, proxy-warnings=${proxyWarningDocuments.length}`);

    expect(runnerOutputDocuments.length).toBeGreaterThan(3);
    expect(proxyWarningDocuments.length).toBeGreaterThan(3);
    expect(proxyWarningDocuments.length).toBeGreaterThanOrEqual(runnerOutputDocuments.length);
  }, 10_000);

  test('is pure: document and branch fully determine findings without mocks', () => {
    const document = canonicalGoal('x'.repeat(1801));
    expect([...lintGoalFile(document, 'topic')]).toEqual([...lintGoalFile(document, 'topic')]);
    expect([...lintGoalFile(document, 'topic')]).toEqual([
      { level: 'WARN', tag: 'boundary-size', message: '## SCOPE BOUNDARY exceeds 1800 characters' },
      { level: 'WARN', tag: 'launch-branch', message: 'current branch is topic, not main' },
    ]);
  });

  test('falsifies evidence-section protection: removing its finding would fail this assertion', () => {
    // Origin enrichment broke this assertion before; origins remain incrementally populated, so derive only its suffix from the canonical constant.
    expect(rendered('## PROBLEM\nno evidence\n')).toContain(expectedRenderedFinding('ERROR', 'evidence-section', '## REQUIRED EVIDENCE must contain at least one - [tag] description entry'));
  });
});
