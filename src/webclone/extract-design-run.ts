// ── 웹 레퍼런스 → «에셋 + DESIGN.md» 실행부 (2026-09-08) ──────────────────────
//
// 🩸 왜 모듈로 있나: 이 로직이 `scripts/webclone/extract-design.ts` «안»에만 있었고,
//    그래서 ***`elanous self entrances` 에 0건***이었다 — 경로를 아는 사람만 쓸 수 있었다.
//    ⛔ `repo-cli.ts` 머리말이 같은 실패를 이미 적어 뒀다(*"기전은 전부 있었다. 그런데
//    방금 개설한 사람은 그것이 있는지조차 모른다"*). ⇒ **한 구현, 두 문**으로 가른다.
//
// ⛔ 이 파일은 화면에 «찍지 않는다» — 호출자가 표현을 소유한다(CLI 든 스크립트든).

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

import { assetExtRegex, tallyAssets, formatAssetTally } from './asset-kinds.js';
import { createCdpClient, createCdpClientFromEndpoint, discoverChromeBinary } from '../browser-cdp/client.js';
import { buildLayoutExpression, parseLayout } from './layout-tokens.js';
import { compareLayoutAcrossViewports, type ViewportSample } from './responsive-layout.js';
import { buildStateMotionExpression, parseStateMotion } from './state-motion.js';
import { buildKeyframesExpression, parseKeyframes } from './keyframes.js';
import { searchBreakpoint, type BreakpointRange } from './breakpoint-search.js';
import { buildExtractionExpression, parseExtraction } from './computed-tokens.js';
import { renderDesignMd } from './design-md.js';
import { cloneSlug } from './webclone-decompose.js';
import { DEFAULT_MIRROR_DEPTH, deriveSiblingHostAllowlist, exactHostAcceptRegex } from './archive-run.js';
import { debug } from '../debug/log.js';

/** 미러가 받은 «자산»만 고른다 — HTML·JS 는 재현 근거가 아니라 원본 코드다. */
/**
 * ⛔⭐ 🩸 여기 «손으로 적은» 목록이 있었고, `m4a` 가 빠져 있었다(2026-09-11 실측).
 *    ⇒ 미러가 `bgm.m4a` 를 «받아 놓고» 자는 「에셋 1개」라고 말했다 — 클론이 조용히 «반쪽»이 됐다.
 *    ⊕ `archive-run` 에 «또 다른» 목록이 있었고 그것은 더 좁았다(mp4·webm 도 없었다).
 * ⇒ 목록은 `asset-kinds.ts` «한 자리»가 canonical 이다. 여기서 다시 적지 않는다.
 */
const ASSET_EXT = assetExtRegex();

export interface ExtractDesignOptions {
  readonly url: string;
  readonly outRoot: string;
  readonly withAssets?: boolean;
  readonly port?: number;
  /**
   * ⭐ CDP 가 뜨기를 기다릴 «예산»(ms).
   * 🩸 왜 인자가 됐나(2026-09-10): 부하 17 인 기계에서 붙기가 실패했고, ***그 오류 문면이
   *    「부하가 높으면 attachTimeoutMs 를 올려라」라고 «말하는데» 올릴 자리가 «없었다»***.
   *    ⛔ 「있다」와 「닿는다」는 다른 값이다.
   */
  readonly attachTimeoutMs?: number;
  /** ⭐ 반응형 축 — 여러 «폭»에서 간격을 잰다. 안 주면 한 폭만 재고 그 사실이 산출에 남는다. */
  readonly viewports?: readonly number[];
  /** ⛔ 시험용 이음매 — 대기를 «주입»으로 가른다(목은 이 파일 밖으로 안 샌다) */
  readonly sleep?: (ms: number) => Promise<unknown>;
  /** ⛔ 시험용 이음매 — 미러 명령을 «주입»으로 가른다.
   *
   *  🩸 왜 있나(2026-09-09): 시험이 `mock.module('node:child_process', …)` 로 갈랐는데
   *     그 목은 «프로세스 전역»이고 `mock.restore()` 로 안 돌아온다(`R-TST23`).
   *     그래서 착지 게이트가 다음 착지를 막았다. `docs-cli.test.ts` 가 이미 쓰는 그 처방
   *     (*"목 대신 주입 심"*)을 따른다 — 목은 이 파일 밖으로 «안 샌다». */
  readonly spawn?: typeof spawnSync;
  /** Browser lookup seam lets downloader-argument tests exercise the real run path without CDP. */
  readonly chrome?: () => string | null;
  /** Browser launch seam keeps downloader argument observation after Chrome preflight without spawning CDP. */
  readonly createBrowser?: typeof createCdpClient;
}

export interface ExtractDesignResult {
  readonly slug: string;
  readonly outDir: string;
  readonly viewport: { w: number; h: number };
  readonly tokenCount: number;
  /** ⚪ null 은 「눈금을 못 골랐다」 — 0 이 아니다 */
  readonly layoutBaseUnit?: number | null;
  /** ⚪ null 은 「레이아웃을 못 쟀다」 */
  readonly layoutSpacingSteps?: number | null;
  /** ⚪ null 은 「한 폭만 쟀다」 — 「반응형이 아니다」가 아니다 */
  readonly responsiveWidths?: readonly number[] | null;
  readonly stableSpacingCount?: number | null;
  /** ⚪ null 은 「상태 전환을 못 쟀다」 */
  readonly stateEasingsOnlyInStates?: number | null;
  readonly keyframesUsed?: number | null;
  readonly keyframesUnused?: number | null;
  /** ⚪ null 이 섞이면 그 구간은 «못 좁혔다» */
  readonly breakpointSpans?: readonly (number | null)[];
  readonly paletteCount: number;
  readonly roleCount: number;
  readonly missingRoles: readonly string[];
  readonly assets: readonly string[];
  /** ⛔ 미러가 «받은 것 전부»(자산이 아닌 것 포함) — 「받았다↔셌다」를 맞대 보는 자리. */
  readonly mirrored?: readonly string[];
  /** 자산을 «왜» 못 받았나. 받았으면 null. ⛔ 0건과 「건너뛰었다」를 한 값으로 접지 않는다. */
  readonly assetNote: string | null;
  /** 페이지 CSS 가 그 질의를 가졌나. ⛔ null = «못 읽었다»(「없다」가 아니다). */
  readonly honoursReducedMotion: boolean | null;
  /** ⚠️ 측정 «조건» — 내 Chrome 이 강제 모드로 떴나. 대상의 성질이 아니다. */
  readonly browserForcedReducedMotion: boolean;
}

/**
 * ⛔⭐ 「받은 것 «전부»」 — 자산 여부를 «안 가린다».
 * 🔑 이것이 있어야 「받았다」와 「셌다」를 «맞대 볼» 수 있다(골프 사이트에서 10 ↔ 1 로 어긋났다).
 */
function walkAll(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else out.push(p);
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (ASSET_EXT.test(name)) out.push(p);
  }
  return out;
}

/**
 * 라이브 URL 에서 «에셋 + DESIGN.md» 를 뽑는다.
 *
 * ⭐ 하이브리드다 — 에셋은 A(정적 미러), 규칙은 B′(computed).
 * ⛔ 미러가 실패해도 «치명적이 아니다» — 규칙 추출은 따로 돌고, 실패 이유를 `assetNote` 로 «값으로» 낸다.
 * @throws 브라우저를 못 띄우거나 computed 를 못 읽으면 던진다 — 호출자가 표현한다.
 */
export async function runExtractDesign(options: ExtractDesignOptions): Promise<ExtractDesignResult> {
  const startedAt = Date.now();
  try {
    const chrome = (options.chrome ?? discoverChromeBinary)();
    if (!chrome) throw new Error('Chrome 을 못 찾았다');
    const slug = cloneSlug(options.url);
    const outDir = join(options.outRoot, slug);
    mkdirSync(join(outDir, 'assets'), { recursive: true });

    let assets: string[] = [];
    let mirrored: string[] = [];
    let assetNote: string | null = null;
    if (options.withAssets === false) {
      assetNote = '자산 수집을 «건너뛰었다»';
    } else {
      const mirrorAllowedHosts = deriveSiblingHostAllowlist(options.url);
      const exactHostFilter = exactHostAcceptRegex(mirrorAllowedHosts);
      const hostTraversalArgs = exactHostFilter
        ? ['--span-hosts', `--domains=${mirrorAllowedHosts.join(',')}`, `--accept-regex=${exactHostFilter}`]
        : [];
      const w = (options.spawn ?? spawnSync)('wget', [
        '--mirror', '-l', String(DEFAULT_MIRROR_DEPTH), '-p', '-k', '-nH', '-q', '-e', 'robots=off',
        '--timeout=30', '--tries=2', '--user-agent=Mozilla/5.0',
        '--restrict-file-names=windows', '-E', ...hostTraversalArgs,
        '-P', join(outDir, 'assets'), options.url,
      ], { encoding: 'utf8', timeout: 180_000 });
      mirrored = walkAll(join(outDir, 'assets')).map((p) => relative(outDir, p)).sort();
      assets = walk(join(outDir, 'assets')).map((p) => relative(outDir, p)).sort();
      if (assets.length === 0) assetNote = `미러가 자산을 «못 받았다» (wget status=${w.status})`;
    }

    // ⛔ CDP 계약이 «둘»이다: 띄우기(browser) ↔ 페이지 타깃. 하나로 하면 Page.enable 이 없다.
    const port = options.port ?? 9355;
    let browser: Awaited<ReturnType<typeof createCdpClient>> | null = null;
    let client: Awaited<ReturnType<typeof createCdpClientFromEndpoint>> | null = null;
    try {
      browser = await (options.createBrowser ?? createCdpClient)({
        headless: true, port, binary: chrome, url: 'about:blank',
        extraFlags: ['--hide-scrollbars', '--force-prefers-reduced-motion', '--window-size=1280,900'],
        timeoutMs: 60_000,
        // ⛔⭐ 2026-09-10 실측 — 여기를 «빼먹어서» 플래그가 안 닿았다.
        //    `timeoutMs`(호출당 감시견)와 `attachTimeoutMs`(붙기 예산)는 «다른 축»이고,
        //    ***붙기가 실패하는 자리는 여기(띄우기)지 아래(페이지 타깃)가 아니었다***.
        //    🔑 잡은 것은 시험이 아니라 ***도구가 자기 예산을 산출에 찍어 준 것***이다(「예산 5000ms」).
        attachTimeoutMs: options.attachTimeoutMs,
      });
      client = await createCdpClientFromEndpoint(port, { attachTimeoutMs: options.attachTimeoutMs });
      const nav = await client.navigate(options.url);
      if (nav.errorText) throw new Error(`navigate: ${nav.errorText}`);
      await Bun.sleep(2500);   // ⛔ 폰트·이미지 전에 재면 박스가 흔들린다

      const tokens = parseExtraction(await client.evaluate(buildExtractionExpression()));
      if (tokens === null) throw new Error('computed 추출을 «못 읽었다»');
      const title = (await client.evaluate('document.title')) as string | null;

      writeFileSync(join(outDir, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);
      // ⛔⭐ 넘기는 것은 «셋»뿐이다 — 나머지는 전부 `tokens` 에서 읽는다.
      //    🩸 2026-09-10: 여기서 `url`·`transitions`·`honoursReducedMotion`·`viewport` 를 넘기고 있었는데
      //       ***구현은 그 중 하나도 «겉에서» 읽지 않았다***. 죽은 칸이 계약을 흔들어 런타임 파손을 낳았다.
      // ⭐ 간격·폭 — 52차부터 「씨앗에 «아예 없다»」로 이월돼 있던 축.
      //    ⛔ 못 읽으면 `null` 을 넘긴다 — 절이 「못 쟀다」라고 «말한다»(생략과 다르다).
      const layout = parseLayout(await client.evaluate(buildLayoutExpression()));
      // ⭐ 상태 전환(가리킴·누름) — 기본 상태만 재면 「전부 ease」로 보인다(52차 RESULT-17).
      //    ⛔ 상태를 «흉내 내지» 않고 스타일시트를 «읽는다» — 페이지를 안 건드린다.
      const stateMotion = parseStateMotion(
        await client.evaluate(buildStateMotionExpression()),
        tokens.transitions.status === 'measured' ? tokens.transitions.easings.map((e) => e.value) : [],
      );

      // ⭐ 키프레임 — 「무엇이」 움직이나. ⛔ 「정의됐다」와 「쓰인다」를 «같이» 센다.
      const keyframes = parseKeyframes(await client.evaluate(buildKeyframesExpression()));

      // ⭐ 반응형 — 폭을 바꿔 «다시» 잰다. ⛔ 못 바꾸면(옛 클라이언트) 조용히 넘어가지 않고 표본을 «안 담는다».
      const responsiveSamples: ViewportSample[] = layout ? [{ width: layout.viewport.w, report: layout }] : [];
      for (const width of options.viewports ?? []) {
        if (!client.send || (layout && width === layout.viewport.w)) continue;
        try {
          await client.send('Emulation.setDeviceMetricsOverride', {
            width, height: 900, deviceScaleFactor: 1, mobile: width < 600,
          });
          await (options.sleep ?? Bun.sleep)(1200);   // ⛔ 재배치가 끝나기 «전»에 재면 박스가 흔들린다
          const at = parseLayout(await client.evaluate(buildLayoutExpression()));
          if (at) responsiveSamples.push({ width, report: at });
        } catch {
          // ⛔ 그 폭을 «못 쟀다» — 표본에 안 담는다. 「그 폭엔 값이 없다」로 «지어내지» 않는다.
        }
      }
      if (client.send && (options.viewports ?? []).length > 0) {
        try { await client.send('Emulation.clearDeviceMetricsOverride', {}); } catch { /* best effort */ }
      }
      const responsive = compareLayoutAcrossViewports(responsiveSamples);

      // ⭐ 분기 «후보»를 이분으로 좁힌다 — 같은 페이지를 폭만 바꾸므로 «네트워크 비용 0».
      //    ⛔ 「본문 px 도 바뀐」 구간만 — 상한(max-width)은 좁힐 것이 «없다».
      const breakpointRanges: { between: readonly [number, number]; range: BreakpointRange | null }[] = [];
      if (client.send) {
        const byWidth = new Map(responsive.containers.map((c) => [c.width, c.containerPx]));
        for (const hint of responsive.breakpointHints.filter((h) => h.containerPxChanged)) {
          const range = await searchBreakpoint(
            { width: hint.between[0], containerPx: byWidth.get(hint.between[0]) ?? null },
            { width: hint.between[1], containerPx: byWidth.get(hint.between[1]) ?? null },
            async (width) => {
              try {
                await client!.send!('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
                await (options.sleep ?? Bun.sleep)(1200);
                const at = parseLayout(await client!.evaluate(buildLayoutExpression()));
                return at?.containers[0]?.px ?? null;
              } catch {
                return null;   // ⛔ 「그 폭에 값이 없다」가 «아니라» 「못 쟀다」다
              }
            },
          );
          breakpointRanges.push({ between: hint.between, range });
        }
        try { await client.send('Emulation.clearDeviceMetricsOverride', {}); } catch { /* best effort */ }
      }
      writeFileSync(join(outDir, 'DESIGN.md'), renderDesignMd({
        tokens,
        title: typeof title === 'string' && title ? title : null,
        layout,
        responsive,
        breakpointRanges,
        stateMotion,
        keyframes,
        assets,
      }));
      writeFileSync(join(outDir, 'NOTICE.md'),
        `# ⛔ \`assets/\` 는 «원본 저작물»이다\n\n${options.url} 에서 재현 «근거»로 받아 왔다.\n`
        + `⛔ 공개 재배포 대상이 아니다 — 배포하려면 자기 에셋으로 교체한다.\n`
        + `파생물은 \`DESIGN.md\` 와 \`tokens.json\` 뿐이다.\n`);

      const result = {
        slug, outDir, viewport: tokens.viewport,
        // ⛔ 「받은 것 전부」를 «같이» 낸다 — 안 그러면 「받았다↔셌다」의 어긋남이 안 보인다.
        mirrored,
        tokenCount: Object.keys(tokens.customProperties).length,
      layoutBaseUnit: layout?.baseUnit ?? null,
      responsiveWidths: responsive.sufficient ? responsive.widths : null,
      stateEasingsOnlyInStates: stateMotion ? stateMotion.easingsOnlyInStates.length : null,
      // ⛔ 「쓰이는 것」만 센다 — 정의만 된 키프레임은 서명이 아니다
      keyframesUsed: keyframes ? keyframes.animations.filter((a) => a.usedBy > 0).length : null,
      keyframesUnused: keyframes ? keyframes.definedButUnused.length : null,
      breakpointSpans: breakpointRanges.map((b) => b.range?.spanPx ?? null),
      stableSpacingCount: responsive.sufficient ? responsive.stableSpacing.length : null,
      layoutSpacingSteps: layout?.spacing.length ?? null,
        paletteCount: Object.entries(tokens.customProperties)
          .filter(([n, v]) => !n.startsWith('--tw-') && /^(#|rgb|hsl|oklch)/i.test(v)).length,
        roleCount: Object.keys(tokens.roles).length,
        missingRoles: tokens.missing,
        assets, assetNote,
        honoursReducedMotion: tokens.honoursReducedMotion,
        browserForcedReducedMotion: tokens.browserForcedReducedMotion,
      };
      try {
        debug.log('webclone.extract', 'done', {
          url: options.url, slug, outRoot: options.outRoot, withAssets: options.withAssets !== false,
          assetCount: result.assets.length, unresolvedCount: result.missingRoles.length,
          elapsedMs: Date.now() - startedAt,
        });
      } catch { /* 관측 실패가 성공한 실행을 실패로 바꾸지 않는다 */ }
      return result;
    } finally {
      try { await client?.close(); } catch { /* 탭 정리 fail-soft */ }
      try { await browser?.close(); } catch { /* 프로세스 정리 fail-soft */ }
    }
  } catch (error) {
    try {
      debug.log('webclone.extract', 'failed', { url: options.url, error: String(error) }, { level: 'error' });
    } catch { /* 관측 실패가 원래 실행 오류를 대체하지 않는다 */ }
    throw error;
  }
}

/** 사람이 읽는 산출 — ⛔ 두 문이 «같은 문장»을 내야 하므로 여기가 정본이다. */
export function formatExtractDesignResult(r: ExtractDesignResult): string[] {
  return [
    `◆ design-extract — ${r.slug}`,
    `  출력        ${r.outDir}`,
    `  뷰포트      ${r.viewport.w}×${r.viewport.h}  ⭐ «잰» 값`,
    `  토큰        ${r.tokenCount}개 (그중 색 ${r.paletteCount} · --tw-* 제외)`,
    `  간격        ${r.layoutSpacingSteps === null || r.layoutSpacingSteps === undefined ? '⚪ 못 쟀다' : `${r.layoutSpacingSteps}종`}`
      + `  ·  기본 단위 ${r.layoutBaseUnit === null || r.layoutBaseUnit === undefined ? '⚪ 못 골랐다' : `${r.layoutBaseUnit}px`}`,
    `  상태 전환   ${r.stateEasingsOnlyInStates === null || r.stateEasingsOnlyInStates === undefined ? '⚪ 못 쟀다' : `기본에 «없던» 가속 곡선 ${r.stateEasingsOnlyInStates}종`}`,
    `  키프레임    ${r.keyframesUsed === null || r.keyframesUsed === undefined ? '⚪ 못 쟀다' : `쓰이는 것 ${r.keyframesUsed}개${r.keyframesUnused ? ` · ⚪ 정의만 ${r.keyframesUnused}개` : ''}`}`,
    `  분기 구간   ${(r.breakpointSpans ?? []).length === 0 ? '⚪ 없다(또는 안 쟀다)' : (r.breakpointSpans ?? []).map((v) => v === null ? '⚪ 못 좁힘' : `${v}px`).join(' · ')}`,
    `  반응형      ${r.responsiveWidths ? `${r.responsiveWidths.join('·')}px 에서 쟀다  ·  전 폭 공통 간격 ${r.stableSpacingCount}종` : '⚪ 한 폭만 쟀다 (⛔ 「반응형이 아니다」가 아니다)'}`,
    `  역할        ${r.roleCount}개${r.missingRoles.length ? `  ⚠️ 없던 역할 ${r.missingRoles.join(', ')}` : ''}`,
    `  에셋        ${formatAssetTally(tallyAssets(r.mirrored ?? r.assets))}${r.assetNote ? `  ⚠️ ${r.assetNote}` : ''}`,
    `  reduced-motion 존중: ${r.honoursReducedMotion === true ? '✅ 있다' : r.honoursReducedMotion === false ? '🔴 없다' : '⚪ 못 읽었다 (⛔ 「없다」가 아니다)'}`
      + `   ⚠️ 측정 조건: 브라우저 강제 ${r.browserForcedReducedMotion ? 'ON' : 'OFF'}`,
    `  ⇒ DESIGN.md · tokens.json · assets/ · NOTICE.md`,
  ];
}
