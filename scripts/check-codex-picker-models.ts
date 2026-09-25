#!/usr/bin/env bun
// 온보딩 피커(`src/codex/models.ts`)가 «실재하는» 모델만 제시하는지 라이브로 대조한다.
//
// 🩸 왜 있나 (2026-09-23 실측): 피커 8개 중 ***둘***(`gpt-5-codex-mini` · `codex-mini-latest`)이
//    ***API 에도 구독 카탈로그에도 없었다.*** 사람이 고르면 그 자리에서 죽는 선택지였다.
//    ⊕ 같은 판에서 ***새 운영 기본(`gpt-6-sol`)이 피커에 아예 없었고*** `recommended` 는
//    이미 대체된 모델을 가리키고 있었다.
//
// ⛔⭐ ***게이트가 «아니다».*** 두 축 다 네트워크가 필요하고(자격·잔량에 좌우된다), 게이트로 만들면
//    「키가 없는 기계」에서 빨강이 된다. ⇒ ***「목록을 내는」 도구***로 둔다. 사람이 읽고 판단한다.
// ⛔ 그래서 이 스크립트는 ***찾은 것을 말하고 rc 로 «단정하지 않는다»*** — 다만 「둘 다 없음」은
//    다툼의 여지가 없으므로 그때만 rc=1 을 낸다(그 판정조차 «조회에 성공했을 때만» 한다).
//
// 📏 쓰는 법:  bun scripts/check-codex-picker-models.ts
//    필요한 것: OPENAI_API_KEY(API 축) · codex CLI 로그인(구독 축). 둘 중 하나만 있어도 돈다.
import { CODEX_MODELS } from '../src/codex/models.js';

type Surface = { name: string; ids: Set<string> | null; why?: string };

async function apiSurface(): Promise<Surface> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { name: 'API(/v1/models)', ids: null, why: 'OPENAI_API_KEY 없음' };
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return { name: 'API(/v1/models)', ids: null, why: `HTTP ${r.status}` };
    const body = (await r.json()) as { data?: Array<{ id?: unknown }> };
    const ids = new Set((body.data ?? []).map((m) => String(m.id)).filter(Boolean));
    return { name: 'API(/v1/models)', ids };
  } catch (e) {
    return { name: 'API(/v1/models)', ids: null, why: e instanceof Error ? e.message : String(e) };
  }
}

async function subscriptionSurface(): Promise<Surface> {
  try {
    const proc = Bun.spawn(['codex', 'debug', 'models'], { stdout: 'pipe', stderr: 'ignore' });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const parsed = JSON.parse(text) as { models?: Array<{ slug?: unknown }> };
    const ids = new Set((parsed.models ?? []).map((m) => String(m.slug)).filter((s) => s && s !== 'undefined'));
    if (ids.size === 0) return { name: '구독(codex debug models)', ids: null, why: '목록이 비어 있다' };
    return { name: '구독(codex debug models)', ids };
  } catch (e) {
    return { name: '구독(codex debug models)', ids: null, why: e instanceof Error ? e.message : String(e) };
  }
}

export async function runCodexPickerCheck(): Promise<number> {
  const [api, sub] = await Promise.all([apiSurface(), subscriptionSurface()]);
  const surfaces = [api, sub];
  for (const s of surfaces) {
    console.log(s.ids ? `  ${s.name}: ${s.ids.size}개` : `  ${s.name}: ⚠️ 못 읽었다 — ${s.why}`);
  }
  const readable = surfaces.filter((s) => s.ids);
  if (readable.length === 0) {
    // ⛔ 「못 읽었다」를 「없다」로 접지 않는다.
    console.log('\n  ⚠️ 두 축을 다 못 읽었다 — ***판정하지 않는다***(rc=2).');
    return 2;
  }

  const rows = CODEX_MODELS.map((m) => ({
    id: m.id,
    recommended: m.recommended === true,
    api: api.ids ? api.ids.has(m.id) : undefined,
    sub: sub.ids ? sub.ids.has(m.id) : undefined,
  }));
  console.log(`\n  ${'model'.padEnd(20)}${'API'.padEnd(6)}${'구독'.padEnd(7)}rec`);
  for (const r of rows) {
    const f = (v: boolean | undefined) => (v === undefined ? '  ? ' : v ? ' ✅ ' : ' ❌ ');
    console.log(`  ${r.id.padEnd(20)}${f(r.api).padEnd(6)}${f(r.sub).padEnd(7)}${r.recommended ? '⭐' : ''}`);
  }

  // 「둘 다 없음」은 읽은 축에서만 판정한다.
  const dead = rows.filter((r) => (r.api === false || r.api === undefined) && (r.sub === false || r.sub === undefined))
    .filter((r) => r.api !== undefined || r.sub !== undefined)
    .filter((r) => r.api !== true && r.sub !== true);
  const rec = rows.filter((r) => r.recommended);

  console.log('');
  if (rec.length !== 1) console.log(`  ⚠️ recommended 가 ${rec.length}개다 — 정확히 하나여야 한다`);
  else if (rec[0].api === false && rec[0].sub === false) console.log(`  🔴 recommended(${rec[0].id})가 «어느 축에도 없다»`);

  if (dead.length === 0) {
    console.log('  ✅ 읽은 축 기준, 어디에도 없는 항목 0');
    return 0;
  }
  console.log(`  🔴 어디에도 없는 항목 ${dead.length}: ${dead.map((d) => d.id).join(', ')}`);
  console.log('     ⇒ 사람이 고르면 그 자리에서 죽는 선택지다. 빼거나 대체를 적어라.');
  return 1;
}

// ⛔ 이 도구가 «못 보는 것»을 스스로 말한다 — 읽는 사람이 「초록 = 최신」으로 읽지 않게.
if (import.meta.main) {
  console.log('codex 온보딩 피커 ↔ 실재 모델 대조 (라이브)\n');
  const rc = await runCodexPickerCheck();
  console.log('\n  🔲 이 검사가 «못 보는» 것: 가격·컨텍스트·설명 문면이 맞는지는 안 본다(존재만 본다).');
  console.log('     그리고 두 축은 «자격»에 좌우된다 — 「못 읽었다」는 「없다」가 아니다.');
  process.exit(rc);
}
