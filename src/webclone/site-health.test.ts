import { describe, expect, test } from 'bun:test';

import {
  compareHealth, findingsFromAdherence, findingsFromAffordances, findingsFromComputed, findingsFromFidelity, internalPaths,
  observationsFromComputed, parseTargets, renderHealthTable, tallyKinds, ALL_FINDING_KINDS,
  SITE_HEALTH_BLIND_SPOTS,
  type HealthFinding, type SiteHealth,  findingsFromLadder,  findingsFromPairs,  findingsFromSpace,  findingsFromMotion,  observationsFromUaDefaults,  observationsFromUnusedRungs,
} from './site-health.js';

describe('findingsFromComputed — 자가 «이미 내고 있던» 경고를 모은다', () => {
  test('실측 — 8816 이 내던 활자 위계 경고를 뽑는다', () => {
    // 📏 2026-09-11 `extract-computed http://127.0.0.1:8816/ --json` 의 실제 산출 조각.
    const f = findingsFromComputed({
      typographyWarnings: [{ role: 'h3', violation: 'not-larger-than-body' }],
      missing: [], diagnostics: {}, paintedColors: { backgrounds: [], text: [] },
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('typography-hierarchy');
    expect(f[0]!.where).toBe('h3');
  });

  test('⛔ 없는 칸을 «0 으로 채우지» 않는다 — 빈 입력은 경고 0이지 거짓 경고가 아니다', () => {
    expect(findingsFromComputed({})).toEqual([]);
    expect(findingsFromComputed(null)).toEqual([]);
    expect(findingsFromComputed('nope')).toEqual([]);
  });

  test('⛔ `paintedColors: null` 은 「색이 없다」가 아니라 «못 셌다»이다', () => {
    const f = findingsFromComputed({ paintedColors: null });
    expect(f.map((x) => x.kind)).toEqual(['painted-unreadable']);
  });

  test('⛔ `chosenCount` 가 «없는» 옛 산출은 대표 판정을 «안 한다» — 못 쟀음이지 대표가 아니다', () => {
    expect(findingsFromComputed({ diagnostics: { h2: { matched: 9, visible: 9, selected: 0 } } })).toEqual([]);
  });

  test('고른 모양이 과반이 아니면 신고한다 — 후보가 «적으면» 신고하지 않는다', () => {
    // 🩸 이 값은 «개수»다 — 옛 이름(`chosenShare`)을 비율로 읽어 이 축이 152 표본에서 0건이었다.
    //    보이는 4개 중 «1개»만 그 모양 ⇒ 과반이 아니다.
    const many = findingsFromComputed({ diagnostics: { h3: { visible: 4, chosenCount: 1 } } });
    expect(many.map((x) => x.kind)).toEqual(['role-unrepresentative']);
    // 보이는 4개 중 «3개»면 과반이다 ⇒ 신고하지 않는다.
    expect(findingsFromComputed({ diagnostics: { h3: { visible: 4, chosenCount: 3 } } })).toEqual([]);
    // 후보가 3개뿐이면 「과반이 아니다」가 의미를 잃는다 — 신고하지 않는다.
    expect(findingsFromComputed({ diagnostics: { h3: { visible: 3, chosenCount: 1 } } })).toEqual([]);
  });
});

describe('findingsFromFidelity — 「왜 못 믿나」를 «이름으로» 낸다', () => {
  test('믿을 수 있으면 경고가 없다', () => {
    expect(findingsFromFidelity({ pixelTrustworthy: true })).toEqual([]);
  });

  test('⭐ 사유를 «접지 않는다» — 정착과 근접공백이 둘 다면 둘 다 적는다', () => {
    const f = findingsFromFidelity({
      pixelTrustworthy: false, captureSettlingTimedOut: true,
      originalNearBlankCapture: 'near-blank', nearBlankClassificationReliable: true, croppedToViewport: true,
    });
    expect(f[0]!.detail).toContain('캡처 정착');
    expect(f[0]!.detail).toContain('근접 공백');
  });

  test('⛔ 사유를 «하나도» 못 읽으면 그것을 말한다 — 조용히 빈 이유를 대지 않는다', () => {
    const f = findingsFromFidelity({ pixelTrustworthy: false });
    expect(f[0]!.detail).toContain('못 읽었다');
  });
});

describe('compareHealth — 「루프」의 본체', () => {
  const site = (over: Partial<SiteHealth>): SiteHealth => ({
    site: 's', url: 'u', measured: true, findings: [], unmeasuredReason: null, ...over,
  });
  const warn = { kind: 'typography-hierarchy' as const, where: 'h3', detail: 'x' };
  const other = { kind: 'silent-to-machines' as const, where: 'aria', detail: 'y' };

  test('고친 것과 새로 난 것을 «각각» 낸다', () => {
    const d = compareHealth(site({ findings: [warn] }), site({ findings: [other] }));
    expect(d.comparable).toBe(true);
    expect(d.fixed.map((f) => f.where)).toEqual(['h3']);
    expect(d.appeared.map((f) => f.where)).toEqual(['aria']);
    expect(d.remaining).toBe(1);
  });

  test('⛔⭐ 한쪽이라도 «못 쟀으면» 증감을 말하지 않는다 — 못 잰 판과 대면 「전부 고쳤다」가 나온다', () => {
    const d = compareHealth(site({ measured: false, unmeasuredReason: '서버 죽음' }), site({ findings: [warn] }));
    expect(d.comparable).toBe(false);
    expect(d.fixed).toEqual([]);
    expect(d.remaining).toBe(1);
  });

  test('같은 경고가 그대로면 고친 것도 새 것도 없다', () => {
    const d = compareHealth(site({ findings: [warn] }), site({ findings: [warn] }));
    expect(d.fixed).toEqual([]);
    expect(d.appeared).toEqual([]);
    expect(d.remaining).toBe(1);
  });
});

describe('renderHealthTable — ⛔ 「못 쟀음」이 분모에 «없다»', () => {
  const rows: SiteHealth[] = [
    { site: 'a', url: 'u', measured: true, findings: [{ kind: 'silent-to-machines', where: 'aria', detail: 'x' }], unmeasuredReason: null },
    { site: 'bb', url: 'u', measured: false, findings: [], unmeasuredReason: '서버 죽음' },
  ];

  test('못 잰 줄은 «경고 0» 으로 찍히지 않는다', () => {
    const out = renderHealthTable(rows).join('\n');
    expect(out).toContain('⚪ 못 쟀다 — 서버 죽음');
    expect(out).toContain('잰 사이트 1/2');
    expect(out).toContain('못 잰 1개는 분모에 «없다»');
  });

  test('전부 쟀으면 분모 경고가 «안» 붙는다', () => {
    const out = renderHealthTable([rows[0]!]).join('\n');
    expect(out).toContain('잰 사이트 1/1');
    expect(out).not.toContain('분모에');
  });
});

// ⛔⭐ 🩸 2026-09-11 — ***자가 「URL 한 장」으로 «사이트»를 판정해 13개 중 11개를 오판했다.***
//    폼은 «상세 페이지»에 있었다(`/lessons/kimchi-01` → button 1 · form 1 · input 4).
describe('internalPaths — 사이트는 «여러 장»이다', () => {
  const html = `
    <link rel="stylesheet" href="/_next/static/css/abc.css">
    <script src="/_next/static/chunks/webpack-1.js"></script>
    <a href="/">홈</a>
    <a href="/lessons/drill-08">드릴</a>
    <a href="/lessons/faucet-02">수도</a>
    <a href="/lessons/drill-08">드릴(중복)</a>
    <a href="https://example.com/x">바깥</a>
    <a href="//cdn.example.com/y">프로토콜 상대</a>
    <a href="/about#top">해시</a>
    <a href="/logo.png">자산</a>`;

  test('실측 모양 — 상세 링크를 «문서 순서»로 뽑는다', () => {
    expect(internalPaths(html, 10)).toEqual(['/lessons/drill-08', '/lessons/faucet-02']);
  });

  test('⛔ 자산을 «장»으로 세지 않는다 — `/_next/…` 와 확장자가 붙은 것', () => {
    expect(internalPaths(html, 10)).not.toContain('/logo.png');
    expect(internalPaths(html, 10).some((p) => p.startsWith('/_'))).toBe(false);
  });

  test('⛔ 바깥 링크를 따라가지 않는다 · 루트와 중복은 한 번만', () => {
    const got = internalPaths(html, 10);
    expect(got).not.toContain('/');
    expect(got.filter((p) => p === '/lessons/drill-08')).toHaveLength(1);
    expect(got.some((p) => p.includes('example.com'))).toBe(false);
  });

  test('⛔ 상한을 «넘지» 않는다 — 0 이면 한 장도 안 본다', () => {
    expect(internalPaths(html, 1)).toEqual(['/lessons/drill-08']);
    expect(internalPaths(html, 0)).toEqual([]);
  });

  test('⛔ 링크가 «하나도 없는» 문서는 빈 목록 — 「못 봤다」가 아니라 「없다」이고, 부르는 쪽이 가른다', () => {
    expect(internalPaths('<p>no links</p>', 5)).toEqual([]);
  });
})

describe('compareHealth — 「어느 장에서 났나」를 접지 않는다', () => {
  const s = (findings: Parameters<typeof compareHealth>[0]['findings']) => ({
    site: 's', url: 'u', measured: true, findings, unmeasuredReason: null,
  });
  test('⛔ 같은 갈래라도 «다른 장»이면 다른 경고다 — 접으면 「고쳤다」가 거짓이 된다', () => {
    const before = s([{ kind: 'silent-to-machines', where: 'aria', detail: 'x', page: '/' }]);
    const after = s([{ kind: 'silent-to-machines', where: 'aria', detail: 'x', page: '/lessons/a' }]);
    const d = compareHealth(before, after);
    expect(d.fixed).toHaveLength(1);
    expect(d.appeared).toHaveLength(1);
  });
})

// ⛔⭐ 「h2 가 없다」 하나로는 결함인지 모른다 — ***h3 가 «있는데» h2 가 없을 때***가 건너뜀이다.
//    📏 실측 2026-09-11: `dongne-hansu` 의 상세가 정확히 그랬다(h1 ⊕ h3 · h2 없음).
describe('heading-level-skip — 「없다」가 아니라 「무엇이 있는데 무엇이 없나」', () => {
  const kinds = (raw: unknown) => findingsFromComputed(raw).map((f) => `${f.kind}:${f.where}`);

  test('⭐ 실측 — h2 가 없고 h3 가 «있으면» 건너뜀이다', () => {
    expect(kinds({ missing: ['h2'] })).toContain('heading-level-skip:h2');
  });

  test('⛔ 사유가 «시각 축»이다 — 접근성 주장을 하지 «않는다»', () => {
    // 🩸 nike.com 에 h1 이 2개 «있는데» 둘 다 0x0 이라 이 자는 「없다」로 센다.
    //    읽어 주는 기계는 그것을 «읽으므로» 「기계가 단계를 잃는다」는 «거짓»이었다.
    const f = findingsFromComputed({ missing: ['h2'] }).find((x) => x.kind === 'heading-level-skip');
    expect(f!.detail).toContain('화면에서');
    expect(f!.detail).toContain('안 보이는');
    expect(f!.detail).not.toContain('읽어 주는 기계가 단계를 잃는다');
  });

  test('⛔ h2 도 h3 도 «없으면» 건너뜀이 아니다 — 짧은 페이지다', () => {
    expect(kinds({ missing: ['h2', 'h3'] })).not.toContain('heading-level-skip:h2');
  });

  test('h1 이 없고 h2 가 있으면 그것도 건너뜀이다', () => {
    expect(kinds({ missing: ['h1'] })).toContain('heading-level-skip:h1');
  });

  test('⛔ 제목이 «다 있으면» 건너뜀 경고가 없다', () => {
    expect(kinds({ missing: ['button'] }).filter((k) => k.startsWith('heading-level-skip'))).toEqual([]);
  });

  test('⛔ `missing` 을 «못 잰» 산출에서는 이 칸을 «안 낸다» — 못 쟀음을 「건너뜀 없음」으로 접지 않는다', () => {
    expect(kinds({}).filter((k) => k.startsWith('heading-level-skip'))).toEqual([]);
  });

  test('⛔ 「역할이 없다」는 이제 «경고가 아니다» — 관측으로 낸다(중복도 한 번)', () => {
    // 🩸 옛 판은 `role-missing` 을 경고로 세어 35건(button 19 · h3 12 · h2 4)을 냈고,
    //    ***실제 결함은 0에 가까웠다*** — 그 잡음이 진짜 신호를 묻었다.
    expect(kinds({ missing: ['button', 'button'] })).toEqual([]);
    // 🩸 2026-09-12: 첫 문면 「역할이 «없다»」는 ***결손처럼 읽혔다*** — 실측상 그 사이트들은
    //    `<button>` 이 «정말 0개»였고 ***링크로 짓는다***. ⇒ 「안 쓴다」로 고쳤다.
    const o = observationsFromComputed({ missing: ['button', 'button'] });
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('«안 쓰는» 역할: button');
    expect(o[0]).toContain('결함이 아니다');        // ⛔ 이 단언이 그 고침의 «전부»다
    expect(o[0]).not.toContain('역할이 «없다»');
  });

  test('⛔ `missing` 을 «못 잰» 산출은 관측도 «빈 목록»이다 — 「전부 있다」가 아니다', () => {
    expect(observationsFromComputed({})).toEqual([]);
    expect(observationsFromComputed(null)).toEqual([]);
  });
})

// ⛔⭐ 🩸 `spotify` 는 `pixelTrustworthy ✅` 였는데 ***미러가 거의 안 그려져 있었다***.
//    ⇒ 「못 믿는다」와 「나쁘다」는 «다른 축»이고, 이 갈래는 그 둘째를 센다.
describe('mirror-under-painted — 「못 믿는다」가 아니라 「나쁘다」', () => {
  const kinds = (raw: unknown) => findingsFromFidelity(raw).map((f) => f.kind);

  test('⭐ 실측 spotify — 픽셀을 «믿을 수 있어도» 덜 칠했으면 신고한다', () => {
    expect(kinds({ pixelTrustworthy: true, paintCoverageVerdict: 'mirror-under-painted' }))
      .toEqual(['mirror-under-painted']);
  });

  test('⛔ 「더 칠했다」·「맞는다」는 신고하지 «않는다»', () => {
    for (const v of ['mirror-over-painted', 'matched', undefined]) {
      expect(kinds({ pixelTrustworthy: true, paintCoverageVerdict: v })).toEqual([]);
    }
  });

  // 🩸⭐⭐ 2026-09-12 — 옛 판은 `unmeasured` 를 «맞는다»와 «같은 묶음»에 넣었다(위 시험이 그것을 물었다).
  //    ⇒ 이 창이 그것을 ***「0 으로 흐르는 아홉 번째 구멍」***으로 보고 갈랐다.
  test('⛔⭐ 「못 쟀다」는 «말한다» — 다만 ***`mirror-under-painted` 가 아니라 `pixel-untrustworthy`***로', () => {
    const k = kinds({ pixelTrustworthy: true, paintCoverageVerdict: 'unmeasured' });
    expect(k).toEqual(['pixel-untrustworthy']);       // ⛔ 「덜 칠했다」와 «안 섞인다»
  });

  test('둘 다 나쁘면 «둘 다» 낸다 — 하나로 접지 않는다', () => {
    expect(kinds({ pixelTrustworthy: false, paintCoverageVerdict: 'mirror-under-painted' }))
      .toEqual(['mirror-under-painted', 'pixel-untrustworthy']);
  });

  test('사유 문면이 «있으면» 그대로 쓴다', () => {
    const f = findingsFromFidelity({ paintCoverageVerdict: 'mirror-under-painted', paintCoverageDetail: '83.3%p 덜', pixelTrustworthy: true });
    expect(f[0]!.detail).toBe('83.3%p 덜');
  });
})

// ⛔⭐ 🩸 conform 일곱 축이 «전부 한 방향»(재현율)이라
//    「씨앗 토큰을 다 쓰고 «그 밖에 아무거나 더» 썼다」도 7/7 만점이 나왔다.
describe('off-token-color — 「토큰만 썼나」(정밀도)', () => {
  const kinds = (raw: unknown) => findingsFromAdherence(raw).map((f) => f.kind);

  test('⭐ 실측 — 토큰 밖 색을 «값과 횟수»로 낸다', () => {
    const f = findingsFromAdherence({ adherence: { used: 11, offToken: [{ value: 'rgb(231, 239, 233)', count: 3 }] } });
    expect(f.map((x) => x.kind)).toEqual(['off-token-color']);
    expect(f[0]!.detail).toContain('rgb(231, 239, 233)(3회)');
  });

  test('⛔ `adherence: null`(못 쟀음)을 「이탈 0」으로 접지 않는다 — 경고도 «안» 낸다', () => {
    expect(kinds({ adherence: null })).toEqual([]);
    expect(kinds({})).toEqual([]);
  });

  test('이탈이 없으면 경고가 없다', () => {
    expect(kinds({ adherence: { used: 11, offToken: [] } })).toEqual([]);
  });

  test('⛔ 모양이 틀린 항목은 «세지 않는다» — 지어낸 이름을 내지 않는다', () => {
    expect(kinds({ adherence: { offToken: [{ value: 1, count: 'x' }] } })).toEqual([]);
  });
})

describe('parseTargets — 토큰·스타일 파일을 «같이» 받는다', () => {
  test('⛔ 옛 형식은 «그대로» 돈다 — 토큰·스타일은 빈 목록이다(「이탈 0」이 아니라 「안 잰다」)', () => {
    expect(parseTargets('a=http://x/')).toEqual([{ name: 'a', url: 'http://x/', tokens: [], styles: [] }]);
  });

  test('`이름=URL|토큰1,토큰2` 를 가른다', () => {
    expect(parseTargets('a=http://x/|/t/a.css, /t/b.css')).toEqual([
      { name: 'a', url: 'http://x/', tokens: ['/t/a.css', '/t/b.css'], styles: [] },
    ]);
  });

  test('🆕 `이름=URL|토큰|스타일` — 셋째 칸이 «쓰인 자리»를 재는 파일이다', () => {
    expect(parseTargets('a=http://x/|/t/a.css|/t/g.css, /t/h.css')).toEqual([
      { name: 'a', url: 'http://x/', tokens: ['/t/a.css'], styles: ['/t/g.css', '/t/h.css'] },
    ]);
  });

  test('⛔ 셋째 칸이 «없어도» 둘째 칸의 뜻이 안 바뀐다 — 옛 줄이 그대로 산다', () => {
    const old = parseTargets('a=http://x/|/t/a.css')[0]!;
    expect(old.tokens).toEqual(['/t/a.css']);
    expect(old.styles).toEqual([]);
  });

  test('⛔ 주석·빈 줄·URL 이 빈 줄은 «안» 담는다', () => {
    expect(parseTargets('# c\n\na=|/t/a.css\nb=http://y/')).toEqual([
      { name: 'b', url: 'http://y/', tokens: [], styles: [] },
    ]);
  });
})

// ⛔⭐ 📏 레퍼런스 4/4 는 ARIA 를 쓰는데 자작 13개는 12개가 0 이었다.
describe('silent-to-machines — 「누를 것이 기계에게 보이나」', () => {
  const kinds = (raw: unknown) => findingsFromAffordances(raw).map((f) => f.kind);

  test('⭐ 양성 대조 — 「시각 선택 ⊕ aria 없음」을 신고하고 «무리 수»를 적는다', () => {
    // 📏 직접 만든 대조로 갈랐다: 시각선택⊕aria없음 → 1무리 · 시각선택⊕aria있음 → 0.
    const f = findingsFromAffordances({ health: { interactive: 18, silentToMachines: true, visualSelectionWithoutAria: 2 } });
    expect(f.map((x) => x.kind)).toEqual(['silent-to-machines']);
    expect(f[0]!.detail).toContain('화면으론');
    expect(f[0]!.detail).toContain('2무리');
  });

  test('⛔ 「상호작용이 적다」로 벌하지 «않는다» — 앞선 두 판이 그랬다', () => {
    // 🩸 ① 「[role] 이 0 이면 침묵」 ② 「상태 신호가 0 이면 침묵」 — 둘 다 적은 페이지를 벌했다.
    expect(findingsFromAffordances({ health: { interactive: 1, ariaRoles: 0, stateSignals: 0, silentToMachines: false } })).toEqual([]);
  });

  test('⛔ 침묵이 아니면 경고가 «없다» — 고친 뒤 상태가 그렇다', () => {
    expect(kinds({ health: { interactive: 18, ariaRoles: 0, stateSignals: 2, silentToMachines: false } })).toEqual([]);
  });

  test('⛔ `health` 가 «없으면» 「침묵 아님」으로 접지 않는다 — 경고도 안 낸다(부르는 쪽이 가른다)', () => {
    expect(kinds({})).toEqual([]);
    expect(kinds(null)).toEqual([]);
  });
})

// ⛔⭐ 🩸 여덟 갈래 중 셋만 걸리고 있었고 그중 하나는 «완전히 죽어» 있었다 —
//    그때는 «손으로» 세어 알았다. 이제 «도구»가 낸다.
describe('tallyKinds — 「한 번도 안 걸린 갈래」를 «스스로» 낸다', () => {
  const row = (kinds: Array<HealthFinding['kind']>): SiteHealth => ({
    site: 's', url: 'u', measured: true, unmeasuredReason: null,
    findings: kinds.map((kind) => ({ kind, where: 'x', detail: 'y' })),
  });

  test('⭐ 적중 수를 «많은 것부터» 낸다', () => {
    const t = tallyKinds([row(['silent-to-machines', 'silent-to-machines']), row(['heading-level-skip'])]);
    expect(t.hits).toEqual([['silent-to-machines', 2], ['heading-level-skip', 1]]);
  });

  test('⛔ 「한 번도 안 걸린 갈래」를 «이름으로» 낸다 — 수만 내면 무엇인지 모른다', () => {
    const t = tallyKinds([row(['silent-to-machines'])]);
    expect(t.never).toContain('role-unrepresentative');
    expect(t.never).not.toContain('silent-to-machines');
    expect(t.never.length).toBe(ALL_FINDING_KINDS.length - 1);
  });

  test('⛔ 경고가 «하나도» 없으면 모든 갈래가 「안 걸림」이다', () => {
    expect(tallyKinds([row([])]).never.length).toBe(ALL_FINDING_KINDS.length);
    expect(tallyKinds([]).hits).toEqual([]);
  });

  test('⛔ 목록이 «갈래 전부»를 담는다 — 빠지면 그 갈래는 0건 목록에 영영 안 뜬다', () => {
    // 🔑 갈래가 `HealthFinding['kind']` 전부인지 «타입»으로는 못 세므로 수로 못 박는다.
    //    🆕 2026-09-12: `off-ladder-size` ⊕ `undeclared-pair-token`(③ 칸의 자 둘)을 더해 11 이 됐다.
    expect(ALL_FINDING_KINDS.length).toBe(13);
    expect(new Set(ALL_FINDING_KINDS).size).toBe(13);
  });

  test('표가 «직접» 말한다 — 「깨끗」이 아니라 「안 재고 있다」', () => {
    const out = renderHealthTable([row(['silent-to-machines'])]).join('\n');
    expect(out).toContain('갈래별 적중');
    expect(out).toContain('한 번도 «안 걸린» 갈래');
    expect(out).toContain('안 재고 있다');
  });
})

// ⛔⭐ 이 저장소가 반복해서 밟은 함정이 ***「0건」을 「없다」로 읽는 것***이라,
//    자는 «자기 사각»을 스스로 낸다(`AFFORDANCE_BLIND_SPOTS` 등이 이미 쓰는 규율).
describe('blindSpots — 자가 «자기 사각»을 낸다', () => {
  test('표가 「못 보는 것」을 «값으로» 낸다', () => {
    const out = renderHealthTable([{
      site: 's', url: 'u', measured: true, findings: [], unmeasuredReason: null,
    }]).join('\n');
    expect(out).toContain('이 자가 «못 보는» 것');
    expect(out).toContain('crawl-limit');
  });

  test('⛔ 「하위 자의 사각을 물려받는다」를 «명시»한다 — 모으는 자의 정직함이다', () => {
    expect(SITE_HEALTH_BLIND_SPOTS.join(' ')).toContain('inherits-sub-blind-spots');
  });

  test('⛔ 「토큰을 안 주면 «안 잰다»」가 사각에 «있다» — 「이탈 0」과 가른다', () => {
    expect(SITE_HEALTH_BLIND_SPOTS.join(' ')).toContain('이탈 0」이 아니다');
  });
})

// ⛔⭐ 「글자가 읽히나」는 `silent-to-machines` 와 «다른 축»이다 — 기계가 아니라 «사람»이 못 읽는다.
describe('text-unreadable — WCAG 대비', () => {
  const kinds = (raw: unknown) => findingsFromAffordances(raw).map((f) => f.kind);

  test('⭐ 실측 bilryo-dongne — 58곳 중 31곳이면 신고하고 «최악»을 같이 낸다', () => {
    const f = findingsFromAffordances({
      health: { silentToMachines: false },
      contrast: { measured: 58, failed: 31, worst: [{ detail: 'rgb(176,179,186) on rgb(255,255,255) 2.10 @13px' }] },
    });
    expect(f.map((x) => x.kind)).toEqual(['text-unreadable']);
    expect(f[0]!.detail).toContain('53%');
    expect(f[0]!.detail).toContain('2.10');
  });

  test('⛔ 실패가 0 이면 신고하지 «않는다» — airbnb 가 그렇다', () => {
    expect(kinds({ health: { silentToMachines: false }, contrast: { measured: 78, failed: 0, worst: [] } })).toEqual([]);
  });

  test('⛔ `contrast: null`(못 쟀음)을 「실패 0」으로 접지 않는다 — 경고도 «안» 낸다', () => {
    expect(kinds({ health: { silentToMachines: false }, contrast: null })).toEqual([]);
    expect(kinds({ health: { silentToMachines: false } })).toEqual([]);
  });

  test('⛔ 두 축이 «같이» 걸리면 «둘 다» 낸다 — 접지 않는다', () => {
    expect(kinds({
      health: { silentToMachines: true, visualSelectionWithoutAria: 1 },
      contrast: { measured: 10, failed: 3, worst: [] },
    })).toEqual(['text-unreadable', 'silent-to-machines']);
  });
})

// ── ③ 칸의 자 — 「칠한 «크기»가 «선언된 사다리»에서 왔나」 ────────────────────
describe('findingsFromLadder', () => {
  test('사다리 밖 크기를 «값과 횟수»로 낸다', () => {
    const f = findingsFromLadder({ ladder: { offLadder: [{ px: 13, count: 4 }, { px: 9, count: 1 }] } });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-ladder-size');
    expect(f[0]!.detail).toContain('13px(4회)');
    expect(f[0]!.detail).toContain('9px(1회)');
  });

  test('⛔⭐ 사다리를 «못 쟀을» 때(null) 경고를 «안» 낸다 — 「이탈 0」을 지어내지 않는다', () => {
    expect(findingsFromLadder({ ladder: null })).toEqual([]);
    expect(findingsFromLadder({})).toEqual([]);
    expect(findingsFromLadder(null)).toEqual([]);
  });

  test('이탈이 «없으면» 경고가 없다', () => {
    expect(findingsFromLadder({ ladder: { offLadder: [] } })).toEqual([]);
  });

  test('⛔ 모양이 깨진 항목은 «세지 않는다»', () => {
    expect(findingsFromLadder({ ladder: { offLadder: [{ px: 'x' }, null, 3] } })).toEqual([]);
  });

  test('⭐ 새 갈래가 「안 걸린 갈래」 분모에 «들어 있다»', () => {
    expect(ALL_FINDING_KINDS).toContain('off-ladder-size');
  });
});

// ── ③ 칸의 자 ② — 「바탕 하나에서만 사는데 이름이 «안 말하는» 색」 ───────────────
describe('findingsFromPairs', () => {
  test('⛔⭐ `fragile` 이 아니라 `undeclared` 를 본다 — 제약이 «있는» 것은 결함이 아니다', () => {
    const f = findingsFromPairs({
      pairs: {
        discriminating: true,
        undeclared: [{ name: '--ink-soft', readableOn: ['--card'] }],
        fragile: [{ name: '--ink-soft' }, { name: '--on-stamp-deep' }],
      },
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('undeclared-pair-token');
    expect(f[0]!.detail).toContain('--ink-soft');
    expect(f[0]!.detail).toContain('--card');
    expect(f[0]!.detail).not.toContain('--on-stamp-deep');
  });

  test('⛔⭐ 바탕이 모자라 «변별 안 함»이면 아무 말도 안 한다 — 「깨끗」이 아니다', () => {
    expect(findingsFromPairs({ pairs: { discriminating: false, undeclared: [{ name: '--x', readableOn: ['--y'] }] } }))
      .toEqual([]);
  });

  test('전부 이름이 말하면 경고가 없다', () => {
    expect(findingsFromPairs({ pairs: { discriminating: true, undeclared: [] } })).toEqual([]);
  });

  test('⛔ 모양이 깨진 항목은 «세지 않는다»', () => {
    expect(findingsFromPairs({ pairs: { discriminating: true, undeclared: [null, 3, { name: 1 }] } })).toEqual([]);
  });

  test('⭐ 새 갈래가 「안 걸린 갈래」 분모에 «들어 있다»', () => {
    expect(ALL_FINDING_KINDS).toContain('undeclared-pair-token');
  });
});

// ── ③ 칸의 «셋째» 축 — 「띄운 간격이 선언한 눈금에서 왔나」 ─────────────────────
describe('findingsFromSpace', () => {
  test('눈금 밖 간격을 «값과 횟수»로 낸다 — 🩸 처음 잡은 것이 브라우저 기본 `p { margin: 1em }` 이었다', () => {
    const f = findingsFromSpace({
      spaceLadder: { discriminating: true, offLadder: [{ px: 14, count: 19 }, { px: 15, count: 10 }] },
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-scale-space');
    expect(f[0]!.detail).toContain('14px(19회)');
  });

  test('⛔⭐ 분모가 모자라 «변별 안 함»이면 아무 말도 안 한다', () => {
    expect(findingsFromSpace({ spaceLadder: { discriminating: false, offLadder: [{ px: 13, count: 2 }] } }))
      .toEqual([]);
  });

  test('⛔ 못 쟀거나(null) 이탈이 없으면 경고가 없다', () => {
    expect(findingsFromSpace({ spaceLadder: null })).toEqual([]);
    expect(findingsFromSpace({ spaceLadder: { discriminating: true, offLadder: [] } })).toEqual([]);
  });

  test('⭐ 새 갈래가 「안 걸린 갈래」 분모에 «들어 있다»', () => {
    expect(ALL_FINDING_KINDS).toContain('off-scale-space');
  });
});

// ── ③ 칸의 «넷째» 축 — 모션 ────────────────────────────────────────────────
describe('findingsFromMotion', () => {
  test('곡선·지속 이탈을 «한 줄»로 모아 낸다', () => {
    const f = findingsFromMotion({
      motion: {
        offTokenEasings: [{ value: 'cubic-bezier(0.6, 0, 0.1, 1)', count: 9 }],
        offTokenDurations: [{ value: '0.35s', count: 2 }],
      },
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-token-motion');
    expect(f[0]!.detail).toContain('cubic-bezier(0.6, 0, 0.1, 1)(9회)');
    expect(f[0]!.detail).toContain('0.35s(2회)');
  });

  test('⛔⭐ 지속을 «못 쟀을» 때는 그 목록이 비어 있어 ***자동으로 조용해진다***', () => {
    expect(findingsFromMotion({ motion: { offTokenEasings: [], offTokenDurations: [] } })).toEqual([]);
  });

  test('⛔ 못 쟀으면(null) 경고가 없다', () => {
    expect(findingsFromMotion({ motion: null })).toEqual([]);
    expect(findingsFromMotion(null)).toEqual([]);
  });

  test('⭐ 새 갈래가 「안 걸린 갈래」 분모에 «들어 있다»', () => {
    expect(ALL_FINDING_KINDS).toContain('off-token-motion');
  });
});

// ── 🩸 전수가 「4 → 0」을 냈는데 «개선이 아니었다» — 「못 쟀다」가 「이탈 0」으로 흘렀다 ──
describe('«못 쟀다»를 «이탈 0»으로 흘리지 않는다', () => {
  test('⛔⭐ 간격: 선언은 있는데 띄운 간격이 «빈» 판은 «못 쟀다»로 말한다', () => {
    const f = findingsFromSpace({ spaceLadder: null, declaredLadder: [8, 16, 24], painted: [] });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-scale-space');
    expect(f[0]!.detail).toContain('못 읽었다');
    expect(f[0]!.detail).toContain('이탈 0」이 아니라');
  });

  test('⛔ 「선언 자체가 없다」는 여전히 조용하다 — 그 축을 «안 잰다»는 뜻이다', () => {
    expect(findingsFromSpace({ spaceLadder: null, declaredLadder: [], painted: [] })).toEqual([]);
  });

  test('⛔ 활자도 «같은 이유»로 말한다', () => {
    const f = findingsFromLadder({ ladder: null, declaredLadder: [14, 15, 26], painted: [] });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-ladder-size');
    expect(f[0]!.detail).toContain('못 읽었다');
  });

  test('⛔ 정상 판정은 «그대로» 돈다', () => {
    expect(findingsFromSpace({ spaceLadder: { discriminating: true, offLadder: [{ px: 15, count: 10 }] } })[0]!.detail)
      .toContain('15px(10회)');
  });
});

// ── 「기본값이 살아 있는 자리」 — ⛔ 경고가 «아니라» 관측이다 ───────────────────
describe('observationsFromUaDefaults', () => {
  test('태그·값·횟수를 «한 줄»로 낸다', () => {
    const o = observationsFromUaDefaults({
      uaDefaults: { leaked: [{ tag: 'figure', marginPx: 15, count: 5, emRatio: 1 }] },
    });
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('figure 15px×5');
    expect(o[0]).toContain('의도일 수 있다');
  });

  test('⛔⭐ 「경고」가 아니므로 갈래 목록에 «없다»', () => {
    expect(ALL_FINDING_KINDS.join(' ')).not.toContain('ua-default');
  });

  test('⛔ 못 쟀거나 비었으면 조용하다', () => {
    expect(observationsFromUaDefaults({ uaDefaults: null })).toEqual([]);
    expect(observationsFromUaDefaults({ uaDefaults: { leaked: [] } })).toEqual([]);
    expect(observationsFromUaDefaults(null)).toEqual([]);
  });

  test('⛔ 모양이 깨진 항목은 «세지 않는다»', () => {
    expect(observationsFromUaDefaults({ uaDefaults: { leaked: [null, 3, { tag: 1 }] } })).toEqual([]);
  });
});

// ── 색 축에도 «같은 구멍»이 있었다 — 「못 쟀다」가 「이탈 0」으로 흐르던 자리 ─────
describe('findingsFromAdherence — «못 쟀다»를 «이탈 0»으로 흘리지 않는다', () => {
  test('⛔⭐ 토큰은 «있는데» 칠한 색이 «빈» 판은 «못 쟀다»로 말한다', () => {
    const f = findingsFromAdherence({ adherence: null, declaredValues: 26, paintedCount: 0 });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-token-color');
    expect(f[0]!.detail).toContain('못 읽었다');
  });

  test('⛔ 「토큰 자체가 없다」는 여전히 조용하다 — 그 축을 «안 잰다»는 뜻이다', () => {
    expect(findingsFromAdherence({ adherence: null, declaredValues: 0, paintedCount: 0 })).toEqual([]);
  });

  test('⛔ 옛 산출(paintedCount 가 «없는» 판)에도 조용하다 — 지어내지 않는다', () => {
    expect(findingsFromAdherence({ adherence: null, declaredValues: 26 })).toEqual([]);
  });

  test('⛔ 정상 판정은 «그대로» 돈다', () => {
    const f = findingsFromAdherence({ adherence: { offToken: [{ value: 'rgb(1,2,3)', count: 4 }] } });
    expect(f[0]!.detail).toContain('rgb(1,2,3)(4회)');
  });
});

// ── 마지막 두 축에도 «같은 구멍»을 막는다 ────────────────────────────────────
describe('모션·쌍 축의 «못 쟀다»', () => {
  test('⛔ 모션: 선언은 «있는데» 쓴 곡선이 «빈» 판은 «못 쟀다»로 말한다', () => {
    const f = findingsFromMotion({ motion: null, declaredEasings: ['cubic-bezier(0,0,1,1)'], usedEasings: [] });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('off-token-motion');
    expect(f[0]!.detail).toContain('못 읽었다');
  });

  test('⛔ 모션: 「선언 자체가 없다」는 조용하다', () => {
    expect(findingsFromMotion({ motion: null, declaredEasings: [], usedEasings: [] })).toEqual([]);
  });

  test('⛔ 쌍: 색 토큰이 «있는데» 판정이 없으면 «못 쟀다»다', () => {
    const f = findingsFromPairs({ pairs: null, colors: 11 });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('undeclared-pair-token');
    expect(f[0]!.detail).toContain('못 쟀다');
  });

  test('⛔ 쌍: 색 토큰이 «0개»면 조용하다 — 그 축을 «안 잰다»', () => {
    expect(findingsFromPairs({ pairs: null, colors: 0 })).toEqual([]);
  });

  test('⛔ 옛 산출(필드가 «없는» 판)에는 «둘 다» 조용하다 — 지어내지 않는다', () => {
    expect(findingsFromMotion({ motion: null })).toEqual([]);
    expect(findingsFromPairs({ pairs: null })).toEqual([]);
  });
});

// ── 어포던스 계열에도 «같은 구멍» — 「못 쟀다」가 「0」으로 흐르던 마지막 두 자리 ──
describe('findingsFromAffordances — «못 쟀다»', () => {
  test('⛔⭐ 어포던스를 «통째로» 못 쟀으면(`health: null`) «그렇게» 말한다 — 여러 갈래가 함께 죽는다', () => {
    const f = findingsFromAffordances({ health: null });
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('silent-to-machines');
    expect(f[0]!.detail).toContain('못 쟀다');
    expect(f[0]!.detail).toContain('함께 빠졌다');
  });

  test('⛔⭐ 그러나 칸이 «아예 없으면»(옛 산출) 조용하다 — ***지어내지 않는다***', () => {
    expect(findingsFromAffordances({})).toEqual([]);
  });

  test('⛔⭐ 🩸 「잰 자리 0곳」은 「전부 읽힌다」가 «아니다»', () => {
    const f = findingsFromAffordances({ health: {}, contrast: { measured: 0, failed: 0 } });
    expect(f.map((x) => x.kind)).toContain('text-unreadable');
    expect(f.find((x) => x.kind === 'text-unreadable')!.detail).toContain('잰 자리가 0곳');
  });

  test('⛔ 잰 자리가 «있고» 실패가 0 이면 조용하다 — 그때는 «진짜» 0 이다', () => {
    const f = findingsFromAffordances({ health: {}, contrast: { measured: 47, failed: 0 } });
    expect(f.map((x) => x.kind)).not.toContain('text-unreadable');
  });

  test('⛔ contrast 칸이 «아예 없으면» 조용하다 — 그 축을 «안 잰다»', () => {
    expect(findingsFromAffordances({ health: {} }).map((x) => x.kind)).not.toContain('text-unreadable');
  });
});

// ── 이 창의 «마지막» 같은 구멍 — 역할 표가 비면 활자 위계 축이 조용했다 ─────────
describe('findingsFromComputed — 역할을 «하나도» 못 읽은 판', () => {
  test('⛔⭐ `roles` 가 «빈 객체»면 «못 쟀다»로 말한다 — 「위계가 옳다」가 아니다', () => {
    const f = findingsFromComputed({ roles: {} });
    expect(f.map((x) => x.kind)).toContain('typography-hierarchy');
    expect(f.find((x) => x.kind === 'typography-hierarchy')!.detail).toContain('못 쟀다');
  });

  test('⛔ `roles: null` 도 «못 쟀다»다', () => {
    expect(findingsFromComputed({ roles: null }).map((x) => x.kind)).toContain('typography-hierarchy');
  });

  test('⛔⭐ 칸이 «아예 없으면»(옛 산출) 조용하다 — 지어내지 않는다', () => {
    expect(findingsFromComputed({}).map((x) => x.kind)).not.toContain('typography-hierarchy');
  });

  test('⛔ 역할을 «읽었으면» 그 줄이 «없다» — 진짜 위계 경고만 남는다', () => {
    const f = findingsFromComputed({ roles: { body: {}, h1: {} }, typographyWarnings: [] });
    expect(f).toEqual([]);
  });
});

// ── 🩸 아홉 번째 구멍 — 사다리 ㉞ 를 «쓴 3분 뒤»에 찾았다 ──────────────────────
describe('findingsFromFidelity — `unmeasured` 를 「온전하다」로 읽지 않는다', () => {
  test('⛔⭐ `paintCoverageVerdict: unmeasured` 는 «못 쟀다»다', () => {
    const f = findingsFromFidelity({ paintCoverageVerdict: 'unmeasured', paintCoverageDetail: '크롭 비교를 못 해 타일을 «안 쟀다»' });
    expect(f.map((x) => x.kind)).toEqual(['pixel-untrustworthy']);
    expect(f[0]!.detail).toContain('못 쟀다');
  });

  test('⛔ `matched` 는 여전히 조용하다 — 그때는 «진짜» 잰 것이다', () => {
    expect(findingsFromFidelity({ paintCoverageVerdict: 'matched', pixelTrustworthy: true })).toEqual([]);
  });

  test('⛔ 「덜 칠했다」는 «그대로» 경고다', () => {
    const f = findingsFromFidelity({ paintCoverageVerdict: 'mirror-under-painted', paintCoverageDetail: '83.3%p 덜', pixelTrustworthy: true });
    expect(f[0]!.detail).toContain('83.3%p');
    expect(f[0]!.detail).not.toContain('못 쟀다');
  });

  test('⛔ 칸이 «아예 없으면» 조용하다 — 지어내지 않는다', () => {
    expect(findingsFromFidelity({ pixelTrustworthy: true })).toEqual([]);
  });
});

// ⛔⭐⭐ 🩸 2026-09-12([S] 의 «다섯째 형태») — ***「③ 을 고쳐도 «원래부터» 안 나르고 있었다».***
//    이 관측은 `check-concept` 입구엔 있었는데 ***이 스윕 입구엔 «고치기 전부터» 없었다.***
//    ⇒ ④(내가 부순 것)와 ⑤(내가 안 본 것)는 처방이 다르다 — ⑤ 는 ***고치기 «전»에 통로를 본다.***
describe('observationsFromUnusedRungs — 「안 쓴 칸」은 경고가 «아니라» 관측', () => {
  // 📏 실측 키(2026-09-12): 활자는 `ladder`, 간격은 `spaceLadder` — ⛔ 첫 판은 `typeLadder` 라 «추측»했다.
  const TYPE = { ladder: { used: 4, declared: 6, offLadder: [], unusedRungs: [32, 38] } };
  const SPACE = { spaceLadder: { used: 4, declared: 5, offLadder: [], unusedSteps: [60] } };

  test('🩸 활자 — 실측 키 `ladder` 를 읽는다', () => {
    const o = observationsFromUnusedRungs(TYPE, '활자');
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('32px · 38px');
    expect(o[0]).toContain('이탈이 아니다');      // ⛔ 「경고 아님」이 문면에 «있어야» 한다
  });

  test('🩸 간격 — 실측 키 `spaceLadder` 를 읽는다(키가 «다르다»)', () => {
    const o = observationsFromUnusedRungs(SPACE, '간격');
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('60px');
  });

  test('⛔ 축을 «바꿔» 주면 조용하다 — 키가 다르므로', () => {
    expect(observationsFromUnusedRungs(TYPE, '간격')).toHaveLength(0);
    expect(observationsFromUnusedRungs(SPACE, '활자')).toHaveLength(0);
  });

  test('안 쓴 칸이 «없으면» 조용하다 (⛔ 빈 배열을 문장으로 만들지 않는다)', () => {
    expect(observationsFromUnusedRungs({ ladder: { unusedRungs: [] } }, '활자')).toHaveLength(0);
  });

  test('⛔ 「못 쟀다」(리포트 자체가 없다)도 조용하다 — «경고 0」으로 흘리지 않는다', () => {
    expect(observationsFromUnusedRungs({}, '활자')).toHaveLength(0);
    expect(observationsFromUnusedRungs(null, '활자')).toHaveLength(0);
  });

  test('⭐ 이것은 «경고 갈래»가 아니다 — ALL_FINDING_KINDS 에 없다', () => {
    expect(ALL_FINDING_KINDS as readonly string[]).not.toContain('unused-rung');
  });
});
