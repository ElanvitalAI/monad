// ── 제거-전 liveness 게이트 (근본 B·2026-07-22 대표 설계) ─────────────────────
//
// RFC author 가 "제거" 를 지시한 심볼이 실제로는 live(운영 call-site 존재)인데 dead 로 오분류한
// 경우를 실행 시점에 결정론적으로 잡는다. 라이브 실증: a85843 RFC phase2 가 `dispatchYoutubeTranscript`
// (src/skills/runner.ts:1377 배선·live 툴 핸들러) 를 제거대상으로 지정 — RFC §2.1(native capability
// 유지)과 자기모순. bun test 안전망도 무력(완료계약이 "테스트도 제거" 지시 → 침묵 capability 손실).
//
// 책임 분담(대표 설계): author=제거 대상 **선언**만 · executor=제거 페이즈 착수 첫 순간 **결정론 grep 검증**
//   → live 면 premise 교정 주입("이 심볼은 아직 Y에서 호출되는 live — 제거 말고 불일치 보고"). agent 도
//   author 도 liveness 를 추론 판단하지 않는다(사실로 확인). 저작이 아닌 실행 시점 = 현재 코드 기준(정확).

import { runGitCommand } from '../git-fs/runner.js';

/** 제거 대상 심볼 ↔ 제거집합 밖 live 참조. */
export interface RemovalLivenessConflict {
  symbol: string;
  liveRefs: string[];   // file:line (제거집합·자기 정의 파일 밖 참조 = 살아있는 사용처)
}

/** 페이즈 텍스트(RFC detail·PLAN)에서 제거 대상 코드 심볼을 결정론 추출(순수). "제거/삭제/폐기/remove/
 *  delete" 를 포함한 문장에서 backtick 심볼 + camelCase 식별자만(휴리스틱·보수적). author 가 구조 필드
 *  `removes:` 를 주면 그걸 우선(carryDeclared) 하되, 없어도 detail 산문에서 뽑아 게이트가 동작하게 한다. */
export function extractRemovalTargets(text: string): string[] {
  const targets = new Set<string>();
  for (const sentence of text.split(/[.\n。]/)) {
    if (!/제거|삭제|폐기|remove|delete/i.test(sentence)) continue;
    for (const m of sentence.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)) targets.add(m[1]!);
    // camelCase(소문자 시작 + 내부 대문자) = 함수/심볼 이름 휴리스틱. 일반 단어·PascalType 은 제외(보수적).
    for (const m of sentence.matchAll(/\b([a-z][a-zA-Z0-9_$]*[A-Z][a-zA-Z0-9_$]*)\b/g)) targets.add(m[1]!);
  }
  return [...targets];
}

/** 페이즈 텍스트에서 제거집합 파일 경로를 결정론 추출(순수) — 제거 문장의 src/·apps/·test/·docs/ 경로.
 *  이 경로 내부 참조는 함께 사라지므로 liveness conflict 에서 제외한다. */
export function extractRemovalPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const sentence of text.split(/[\n。]/)) {
    if (!/제거|삭제|폐기|remove|delete/i.test(sentence)) continue;
    for (const m of sentence.matchAll(/\b((?:src|apps|tests?|docs|scripts)\/[A-Za-z0-9_./-]+)/g)) paths.add(m[1]!);
  }
  return [...paths];
}

/** 순수 liveness 판정 — 각 심볼의 grep 결과 중 **제거집합 경로 밖 + 테스트 아닌** 참조가 있으면 conflict.
 *  grep 은 주입(테스트 mock·prod=git grep). 제거집합 안 참조=함께 사라짐(OK). 테스트 참조=제거 대상의
 *  자기 테스트로 간주(함께 제거·OK). 운영 call-site(예: runner.ts:1377)만 남으면 = 살아있음(제거 위험). */
export function checkRemovalLiveness(
  targets: readonly string[],
  removalPaths: readonly string[],
  grep: (symbol: string) => string[],
): RemovalLivenessConflict[] {
  const conflicts: RemovalLivenessConflict[] = [];
  const norm = (p: string): string => p.replace(/^\.\//, '');
  for (const sym of targets) {
    let refs: string[];
    try { refs = grep(sym); } catch { continue; }
    const live = refs.filter((r) => {
      const path = norm(r.split(':')[0] ?? '');
      if (!path) return false;
      // ★ 코드 참조만 liveness — 문서(.md·docs/)·설정 언급은 심볼이 살아있다는 증거가 아니다(false-positive
      //   근본: dispatchYoutubeTranscript 가 DESIGN 문서에 8번 언급돼 진짜 신호 runner.ts 를 묻고, dead 인
      //   saveKnowledgeNote 도 회고 문서 언급만으로 live 오탐). 코드 확장자(.ts/.tsx/.js/.mjs/.cjs)만 센다.
      if (!/\.[cm]?[jt]sx?$/.test(path)) return false;
      if (removalPaths.some((rp) => path === norm(rp) || path.startsWith(norm(rp)))) return false; // 제거집합 내부
      if (/\.test\.[cm]?[jt]sx?$|(^|\/)__tests__\//.test(path)) return false; // 자기 테스트(함께 제거)
      return true;
    });
    if (live.length > 0) conflicts.push({ symbol: sym, liveRefs: live.slice(0, 8) });
  }
  return conflicts;
}

/** conflict → 실행 프롬프트 premise 교정 블록(순수). 없으면 ''. agent 가 RFC 의 잘못된 제거 지시를
 *  맹종하지 않고 사실(live 사용처)을 최우선 인지·불일치 보고하게 한다. */
export function formatRemovalLivenessWarning(conflicts: readonly RemovalLivenessConflict[]): string {
  if (!conflicts.length) return '';
  const lines = [
    '[★★ 제거-전 liveness 사실 확인(최우선) — RFC 제거 지시와 실제 코드 불일치]',
    '아래 심볼은 RFC 가 "제거" 로 지정했으나, 실행 시점 코드에서 **아직 살아있는 사용처**가 있다(자기 테스트·제거집합 제외).',
    '제거하면 그 사용처(운영 capability)가 깨진다. RFC 지시를 맹종하지 말고 — 이 심볼은 **제거하지 말고**, 불일치를',
    'VERDICT 근거에 명시해 보고하라(RFC 처분 오류 가능성). 정말 dead 임이 확실할 때만 제거한다.',
  ];
  for (const c of conflicts) {
    lines.push(`- \`${c.symbol}\` — live 참조 ${c.liveRefs.length}건: ${c.liveRefs.join(' · ')}`);
  }
  return lines.join('\n');
}

/** 실행 시점 executor 진입점 — 페이즈 텍스트에서 제거대상 추출 → git grep 으로 liveness 검증 → 경고 블록.
 *  declared(author 의 removes 선언)가 있으면 합집합. repoRoot 에서 git grep(빠름·gitignore 존중). fail-soft. */
export function computeRemovalLivenessWarning(
  phaseText: string,
  repoRoot: string,
  opts: { declared?: readonly string[]; removalPaths?: readonly string[]; grep?: (symbol: string) => string[] } = {},
): string {
  const targets = [...new Set([...(opts.declared ?? []), ...extractRemovalTargets(phaseText)])];
  if (!targets.length) return '';
  const removalPaths = opts.removalPaths ?? extractRemovalPaths(phaseText);
  const grep = opts.grep ?? ((symbol: string): string[] => {
    try {
      // 정의(word-boundary) 참조를 file:line 으로. -w 단어경계·-n 라인번호. 없으면 exit1→catch.
      const result = runGitCommand(repoRoot, ['grep', '-nw', '--', symbol], {
        encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
      });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch { return []; }
  });
  return formatRemovalLivenessWarning(checkRemovalLiveness(targets, removalPaths, grep));
}
