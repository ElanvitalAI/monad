// 셸 프롬프트 패턴 자동감지 — codex/aider/generic 승인·선택 프롬프트 (§6(b) · 2026-07-20)
//
// DESIGN-cross-surface-autonomy-membrane §6(b). LLM 이 매번 알아채 RelayShellPrompt 를
// 부르지 않아도, 셸 출력 꼬리에서 승인/선택 프롬프트를 **정규식으로 감지·구조화**해 relay
// 라운드트립(decideRelayMode)으로 흘려보낸다. 이건 순수 감지기 — 관측/주입은 호출측(relay)이.
//
//   detectShellPrompt(text) → { kind:'confirm'|'menu', prompt, options?, lowRisk, source } | null
//
// ★ 제1원칙(자기인지·힐링): lowRisk 는 **보수적**(기본 false=고위험=escalate). "저위험만 자율"
//   (§5 safe 티어)이라, 애매하면 사람에게. 오탐(프롬프트 아닌데 감지)은 relay 가 escalate 로
//   흡수(사람이 무시) — 미탐(프롬프트인데 놓침)보다 안전. 프롬프트는 출력 **꼬리**에 뜨므로
//   마지막 비어있지 않은 줄들만 스캔(중간 로그의 y/n 오탐 방지).

/** 감지된 프롬프트 종류 — confirm(y/N) vs menu(N지선다). */
export type DetectedKind = 'confirm' | 'menu';

export interface DetectedPrompt {
  kind: DetectedKind;
  /** ux 표면화·관측용 질문 문구(감지된 프롬프트 줄). */
  prompt: string;
  /** kind='menu' 선택지(표시 순서). confirm 이면 없음. */
  options?: string[];
  /** 저위험(=safe 티어에서 auto 후보). 보수적 기본 false. */
  lowRisk: boolean;
  /** 어떤 패턴이 맞았나(관측·디버깅). */
  source: 'codex' | 'aider' | 'generic-yn' | 'generic-menu' | 'benign';
  /** menu 주입 스타일 힌트 — 'text'(라벨 타이핑) vs 'arrows'(방향키 네비). 기본 text. */
  optionStyle?: 'text' | 'arrows';
}

/** 출력 꼬리(마지막 비어있지 않은 N줄)만 본다 — 중간 로그의 y/n 오탐 방지. */
function tailLines(text: string, n = 6): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim().length > 0).slice(-n);
}

/** 부작용 동사(패치·실행·삭제·쓰기·commit·push)가 있으면 고위험 — auto 금지. */
const RISKY = /\b(apply|patch|run|execute|exec|delete|remove|rm\b|overwrite|write|commit|push|deploy|force)\b/i;

/** 명백히 무해한 프롬프트(continue·press enter)만 저위험 허용. */
const BENIGN = /(press\s+enter|continue\s*\?|proceed\s+to\s+read|show\s+more)/i;

/** 저위험 판정 — BENIGN 이고 RISKY 아님일 때만 true(보수적). */
function assessLowRisk(line: string): boolean {
  return BENIGN.test(line) && !RISKY.test(line);
}

/** aider 스타일 인라인 옵션 `(Y)es/(N)o/(A)ll/(D)on't` → 헤드문자 배열. */
function parseAiderOptions(line: string): string[] | null {
  const m = line.match(/\((\w)\)\w+(?:\/\((\w)\)\w+)+/);
  if (!m) return null;
  const opts = [...line.matchAll(/\((\w)\)(\w+)/g)].map((g) => g[2] as string);
  return opts.length >= 2 ? opts : null;
}

/** 번호 메뉴 `1) foo` / `2. bar` 를 옵션 배열로(꼬리 줄들에서). */
function parseNumberedMenu(lines: string[]): string[] | null {
  const opts: string[] = [];
  for (const l of lines) {
    const m = l.match(/^\s*(\d+)[).]\s+(.*\S)/);
    if (m) opts.push(m[2] as string);
  }
  return opts.length >= 2 ? opts : null;
}

/**
 * 셸 출력에서 승인/선택 프롬프트를 감지. 없으면 null.
 * confirm(y/N) 과 menu(N지선다) 두 형태. 우선순위: 명시 메뉴 > y/N confirm.
 */
export function detectShellPrompt(text: string): DetectedPrompt | null {
  if (!text || !text.trim()) return null;
  const lines = tailLines(text);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1] as string;
  const joined = lines.join('\n');

  // ── 번호 메뉴(1) .. 2) ..) — 마지막 줄이 프롬프트, 위가 항목 ──
  const numbered = parseNumberedMenu(lines);
  if (numbered) {
    return { kind: 'menu', prompt: last, options: numbered, lowRisk: false, source: 'generic-menu', optionStyle: 'arrows' };
  }

  // ── aider 인라인 옵션 `(Y)es/(N)o/(A)ll` ──
  const aider = parseAiderOptions(last);
  if (aider) {
    return { kind: 'menu', prompt: last, options: aider, lowRisk: assessLowRisk(last), source: 'aider', optionStyle: 'text' };
  }

  // ── codex 승인(Apply patch? · Allow command? · Run command?) ──
  if (/\b(apply\s+(this\s+)?patch|allow\s+command|run\s+command|approve\s+(the\s+)?(patch|command|edit))\b.*\??/i.test(joined)) {
    return { kind: 'confirm', prompt: last, lowRisk: false, source: 'codex' };
  }

  // ── generic y/N confirm — [y/N] · (y/n) · (yes/no) · [Y/n] ──
  if (/(\(y\/n\)|\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\byes\/no\b)/i.test(last)) {
    return { kind: 'confirm', prompt: last, lowRisk: assessLowRisk(last), source: assessLowRisk(last) ? 'benign' : 'generic-yn' };
  }

  return null;
}
