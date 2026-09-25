// ── 산출물 린트 실행부 — 한 구현, 두 문 (2026-09-08) ─────────────────────────
//
// 🩸 왜 모듈로 있나: 이 로직이 `scripts/webclone/lint-design.ts` «안»에만 있어
//    `monad self entrances` 에 «0건»이었다. 이 창의 도구 여섯 중 닿는 것은 «하나»뿐이었다.
// ⛔ 이 파일은 화면에 «찍지 않는다» — 호출자가 표현을 소유한다.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { debug } from '../debug/log.js';
import { reportDesignTokens } from './design-tokens.js';
import { lintArtifact, type LintResult } from './lint-artifact.js';

export interface LintDesignInput {
  readonly htmlPath: string;
  readonly cssPath?: string;
  readonly designPath?: string;
}

export interface LintDesignRun extends LintResult {
  readonly htmlPath: string;
  readonly cssPath: string;
  /** ⛔ 「CSS 가 없다」와 「위반이 0」은 다른 값이다 — 없으면 그 규칙들은 «검사 안 됨»이다. */
  readonly cssFound: boolean;
  readonly designPath: string;
  readonly designFound: boolean;
  readonly paletteCount: number;
  readonly typographyCount: number;
}

/** @throws HTML 을 못 읽으면 던진다 — 호출자가 표현한다. */
export function runLintDesign(input: LintDesignInput): LintDesignRun {
  try {
    if (!existsSync(input.htmlPath)) throw new Error(`HTML 을 못 찾았다: ${input.htmlPath}`);
    const html = readFileSync(input.htmlPath, 'utf8');

    // CSS 를 안 주면 «같은 폴더의 styles.css». ⛔ 못 찾으면 「없다」고 말한다(빈 문자열로 조용히 넘기지 않는다).
    const cssPath = input.cssPath ?? join(dirname(input.htmlPath), 'styles.css');
    const cssFound = existsSync(cssPath);
    const css = cssFound ? readFileSync(cssPath, 'utf8') : '';

    const designPath = input.designPath ?? join(dirname(input.htmlPath), 'DESIGN.md');
    const designFound = existsSync(designPath);
    const tokens = designFound ? reportDesignTokens(readFileSync(designPath, 'utf8')) : null;

    const result = lintArtifact({
      html, css,
      declaredTokens: tokens ? [...tokens.palette.tokens, ...tokens.typography.tokens] : undefined,
    });

    const run = {
      ...result,
      htmlPath: input.htmlPath, cssPath, cssFound, designPath, designFound,
      paletteCount: tokens?.palette.tokens.length ?? 0,
      typographyCount: tokens?.typography.tokens.length ?? 0,
    };
    debug.log('design.lint', 'done', {
      htmlPath: run.htmlPath,
      cssPath: run.cssPath,
      designPath: run.designPath,
      p0Count: run.p0Count,
      advisoryCount: run.advisoryCount,
      uncheckedRuleCount: run.skipped.length,
    });
    return run;
  } catch (error) {
    debug.log('design.lint', 'failed', { htmlPath: input.htmlPath, error: String(error) }, { level: 'error' });
    throw error;
  }
}

/** 사람이 읽는 산출 — ⛔ 두 문이 «같은 문장»을 내야 하므로 여기가 정본이다. */
export function formatLintDesignRun(r: LintDesignRun): string[] {
  const lines = [
    `◆ design-lint — ${r.htmlPath}`,
    `  CSS     ${r.cssFound ? r.cssPath : '🔴 못 찾았다 — CSS 규칙은 «검사 안 됨»이다'}`,
    `  씨앗    ${r.designFound ? `${r.designPath} (토큰 ${r.paletteCount}색 · ${r.typographyCount}타이포)` : '🔴 없다 — 씨앗 의존 규칙은 «검사 안 됨»'}`,
    `  ── 결과 ──`,
    `  ⛔ P0 위반   ${r.p0Count}`,
    `  ⚠️ advisory  ${r.advisoryCount}`,
  ];
  for (const f of r.findings) {
    lines.push(`    ${f.severity === 'p0' ? '⛔' : '⚠️'} ${f.rule}${f.line !== null ? ` (줄 ${f.line})` : ''}`);
    lines.push(`       ${f.evidence.slice(0, 88)}`);
    lines.push(`       → ${f.why}`);
  }
  if (r.skipped.length) {
    lines.push('  ⚪ 검사 «안 된» 규칙 — ⛔ 통과가 아니다');
    for (const s of r.skipped) lines.push(`    · ${s}`);
  }
  return lines;
}
