// ── 영상 도구 «설정» — 레지스트리를 코드 밖에서 덮는다 ─────────────────────
//
// ⛔ 계기: 레지스트리가 TypeScript 에 박혀 있으면
//    ⑴ 고객 기계를 «기술»할 수 없고 ⑵ 새 도구를 넣으려면 저장소를 고쳐야 한다.
//    AX 현장에서는 둘 다 막힌다 — 고객 기계에 monad 가 없을 수도 있다.
//
// 📌 찾는 순서 (먼저 찾은 것이 이긴다 · ⛔ env 로 «값»을 받지 않는다 — 경로만):
//    ① --config <path>
//    ② $MONAD_VIDEO_TOOLS            (경로만)
//    ③ ./video-tools.json            (프로젝트)
//    ④ ~/.monad/video-tools.json     (사용자)
//
// ⛔ 설정이 «없어도» 돈다 — 내장 레지스트리가 기본값이다. 설정은 «덮개»지 «전제»가 아니다.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CAPABILITIES, type Capability, type Impl, type Tier } from './capabilities.js';
import { getMonadConfigDir } from '../monad-config-dir.js';

export interface MachineProfile {
  /** 실제로 재나. false 면 have/missing 목록만 믿는다(= 고객 기계 가정). */
  readonly detect?: boolean;
  /** detect=false 일 때 «있다»고 볼 impl id. */
  readonly have?: readonly string[];
  /** detect 여부와 «무관하게» 없다고 볼 impl id. */
  readonly missing?: readonly string[];
  readonly note?: string;
}

export interface VideoToolsConfig {
  /** impl 덮어쓰기·추가. 키 = impl id. */
  readonly impls?: Readonly<Record<string, Partial<Impl> & { readonly capability?: string }>>;
  /** 새 능력 추가. 키 = capability id. */
  readonly capabilities?: Readonly<Record<string, { readonly what: string; readonly impls: readonly Impl[] }>>;
  readonly machines?: Readonly<Record<string, MachineProfile>>;
  /** 기본 계층 선호. */
  readonly prefer?: Tier;
}

export interface LoadedConfig {
  readonly config: VideoToolsConfig;
  /** ⛔ 「어디서 왔나」를 «항상» 낸다 — 설정이 안 먹는 사고의 8할이 이 칸이 없어서 난다. */
  readonly source: string;
  /** ⛔ 설정을 «못 읽었다». 비어 있지 않으면 호출자는 계획을 «세우면 안 된다» — 다른 설정의 계획이 된다. */
  readonly error?: string;
}

/**
 * ⛔⭐⭐ 9차 리뷰 ⑤ — 종전엔 «JSON 으로 읽히기만 하면» 통과였다.
 *   `{"prefer":"not-a-tier"}` 같은 «유효한 JSON 인데 의미가 깨진» 설정이 exit 0 으로 지나갔고,
 *   그 값은 계획 단계에서 «아무 계층에도 안 걸려» 조용히 무시된다.
 *   🔑 ***파싱 성공은 계약 충족이 아니다.*** 외부 입력은 enum 까지 눌러 본다.
 * ⛔ 「모르는 키」는 막지 않는다 — 앞으로 늘 키를 지금 거부하면 설정이 못 자란다(의도적 결정).
 */
const TIERS: readonly string[] = ['free', 'owned', 'metered'];
const PROBE_KINDS: readonly string[] = ['cmd', 'path', 'mcp'];

/** ⛔ `typeof [] === 'object'` 다 — 「맵이다」를 이 자로만 묻는다(10·11차에 두 층에서 샜다). */
const isMap = (v: unknown): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateConfig(cfg: unknown): string[] {
  const errs: string[] = [];
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return ['설정이 객체가 아니다'];
  const c = cfg as Record<string, unknown>;

  if (c.prefer !== undefined && !TIERS.includes(c.prefer as string)) {
    errs.push(`prefer='${String(c.prefer)}' 는 없는 계층이다 — 가능: ${TIERS.join(' · ')}`);
  }

  const checkImpl = (at: string, im: unknown): void => {
    // ⛔ 11차 리뷰 ② — `typeof [] === 'object'` 다. 배열을 «객체»로 읽으면 한 층 아래서 같은 구멍이 난다.
    if (!isMap(im)) { errs.push(`${at} 가 «맵»이 아니다`); return; }
    const i = im as Record<string, unknown>;
    if (i.tier !== undefined && !TIERS.includes(i.tier as string)) {
      errs.push(`${at}.tier='${String(i.tier)}' 는 없는 계층이다 — 가능: ${TIERS.join(' · ')}`);
    }
    // ⛔⭐ 15차 리뷰 ⑥ — 아는 필드의 «타입 계약»이 비어 있었다.
    //   `hasFreeQuota: "yes"` 가 통과했고, 문자열 truthiness 가 ***「무료 쿼터가 있다」는 사실로 소비된다***.
    //   🔑 ***아는 이름을 «아무 값»으로 받는 것은 모르는 이름을 받는 것보다 나쁘다*** —
    //      모르는 이름은 버려지지만, 아는 이름은 «틀린 값으로 쓰인다».
    if (i.hasFreeQuota !== undefined && typeof i.hasFreeQuota !== 'boolean') {
      errs.push(`${at}.hasFreeQuota 가 불리언이 아니다(문자열은 언제나 참으로 읽힌다)`);
    }
    for (const k of ['provider', 'quotaProbe', 'unitCost', 'note'] as const) {
      if (i[k] !== undefined && typeof i[k] !== 'string') errs.push(`${at}.${k} 가 문자열이 아니다`);
    }
    if (i.probe !== undefined) {
      const pr = i.probe as Record<string, unknown> | null;
      if (pr === null || typeof pr !== 'object') errs.push(`${at}.probe 가 객체가 아니다`);
      else {
        if (!PROBE_KINDS.includes(pr.kind as string)) {
          errs.push(`${at}.probe.kind='${String(pr.kind)}' 는 없는 갈래다 — 가능: ${PROBE_KINDS.join(' · ')}`);
        }
        if (typeof pr.value !== 'string' || pr.value.length === 0) errs.push(`${at}.probe.value 가 비었다`);
      }
    }
  };

  // ⛔⭐ 10차 리뷰 ④ — `{"machines":[]}` 가 통과했다. 배열도 `Object.entries` 가 «돌기» 때문이다
  //   (빈 배열이면 0회 돌고 「오류 없음」이 된다). ⇒ 「반복된다」를 「맵이다」로 읽지 않는다.
  for (const k of ['impls', 'capabilities', 'machines'] as const) {
    if (c[k] !== undefined && !isMap(c[k])) errs.push(`${k} 가 «맵»이 아니다(배열·원시값은 못 쓴다)`);
  }
  if (errs.length > 0) return errs; // ⛔ 꼴이 틀리면 안쪽을 도는 것이 무의미하다

  // ⛔ 11차 리뷰 ③ — `capability` 는 «새 구현을 어느 능력에 붙이나»를 정한다.
  //   꼴이 틀리면 그 구현이 ***조용히 버려진다***(설정을 썼는데 안 먹는 그 침묵이다).
  for (const [id, patch] of Object.entries((c.impls ?? {}) as Record<string, unknown>)) {
    checkImpl(`impls.${id}`, patch);
    if (isMap(patch)) {
      const cap = (patch as Record<string, unknown>).capability;
      if (cap !== undefined && (typeof cap !== 'string' || cap.length === 0)) {
        errs.push(`impls.${id}.capability 가 문자열이 아니다 — 그 구현은 조용히 버려진다`);
      }
    }
  }

  for (const [id, spec] of Object.entries((c.capabilities ?? {}) as Record<string, unknown>)) {
    if (!isMap(spec)) { errs.push(`capabilities.${id} 가 «맵»이 아니다(배열·원시값은 못 쓴다)`); continue; }
    const sp = spec as Record<string, unknown>;
    if (typeof sp.what !== 'string' || sp.what.length === 0) errs.push(`capabilities.${id}.what 가 비었다`);
    if (!Array.isArray(sp.impls) || sp.impls.length === 0) { errs.push(`capabilities.${id}.impls 가 비었다`); continue; }
    sp.impls.forEach((im, k) => {
      checkImpl(`capabilities.${id}.impls[${k}]`, im);
      // ⛔⭐ 12차 리뷰 — 여기서 `null` 이 오면 아래 `i.id` 가 «던졌다».
      //   ***진단을 내겠다고 만든 함수가 진단 대신 예외를 냈다*** — 그러면 호출자는
      //   「설정이 틀렸다」가 아니라 「도구가 죽었다」를 본다. 공개 검증 함수는 «값»만 낸다.
      if (!isMap(im)) return; // checkImpl 이 이미 그 줄을 적었다
      const i = im as Record<string, unknown>;
      // ⛔ 새 능력의 impl 은 «완전»해야 한다 — patch 와 달리 기댈 내장값이 없다.
      if (typeof i.id !== 'string' || i.id.length === 0) errs.push(`capabilities.${id}.impls[${k}].id 가 비었다`);
      if (i.tier === undefined) errs.push(`capabilities.${id}.impls[${k}].tier 가 없다`);
      if (i.probe === undefined) errs.push(`capabilities.${id}.impls[${k}].probe 가 없다`);
    });
  }

  for (const [name, m] of Object.entries((c.machines ?? {}) as Record<string, unknown>)) {
    if (!isMap(m)) { errs.push(`machines.${name} 이 «맵»이 아니다(배열·원시값은 못 쓴다)`); continue; }
    const mm = m as Record<string, unknown>;
    for (const k of ['have', 'missing'] as const) {
      const v = mm[k];
      if (v === undefined) continue;
      if (!Array.isArray(v)) { errs.push(`machines.${name}.${k} 가 배열이 아니다`); continue; }
      // ⛔ 원소까지 본다 — `have: [1,2]` 는 impl id 와 «절대» 안 맞고, 그러면 그 기계는 조용히 「전부 없음」이 된다.
      v.forEach((x, i) => {
        if (typeof x !== 'string' || x.length === 0) errs.push(`machines.${name}.${k}[${i}] 가 문자열이 아니다`);
      });
    }
    if (mm.detect !== undefined && typeof mm.detect !== 'boolean') errs.push(`machines.${name}.detect 가 불리언이 아니다`);
    // ⛔ 20차 리뷰 ② — 아는 필드는 «전부» 누른다. 하나 빠지면 그 하나가 다음 판의 표본이 된다.
    if (mm.note !== undefined && typeof mm.note !== 'string') errs.push(`machines.${name}.note 가 문자열이 아니다`);
  }
  return errs;
}

export function findConfigPath(explicit?: string): string | null {
  // ⛔⭐⭐ ***`join(homedir(), '.monad', …)` 를 손으로 짓지 «않는다».***
  //
  // 🩸 실측 2026-09-22 — `pr land` 의 격리 게이트가 이 줄 하나로 착지를 «막았다»:
  //   `src/video-pipeline/config.ts: 0 → 1 (+1 신규 하드코딩 · line 162)`
  //   ⛔ 그리고 ***나는 그때까지 이 결함을 몰랐다*** — 이 축의 관문 아홉(⑴~⑼) 중
  //     격리를 보는 것이 «하나도» 없었다. `pr land` 를 처음 쳐 보고서야 나왔다.
  //   🔑 ***「내 관문이 초록」과 「착지할 수 있다」는 다른 값이다.***
  //
  // ⇒ 격리가 성립하려면 스토어 경로가 resolver 를 «거쳐야» 한다:
  //   `getMonadConfigDir()` 은 `effectiveInstanceRoot()` 를 소비해 ***test 우주를 따라간다.***
  //   손으로 지은 `~/.monad` 는 격리 런에서도 ***운영 설정을 읽는다*** — 그것이 누출이다.
  const candidates = [
    explicit,
    process.env.MONAD_VIDEO_TOOLS,
    join(process.cwd(), 'video-tools.json'),
    join(getMonadConfigDir(), 'video-tools.json'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const c of candidates) { const p = resolve(c); if (existsSync(p)) return p; }
  return null;
}

export function loadConfig(explicit?: string): LoadedConfig {
  // ⛔⭐⭐ 8차 리뷰 ③ — 명시 경로가 «없을 때» 조용히 env·cwd·home 으로 폴백했다.
  //   ⇒ 사람이 「이 고객 기계 설정으로 계획하라」고 줬는데 ***다른 설정의 계획***이 나온다.
  //   🔑 명시는 «후보 목록의 첫 칸»이 아니라 «못 박은 한 칸»이다. 없으면 폴백이 아니라 실패다.
  if (explicit !== undefined && explicit.length > 0 && !existsSync(resolve(explicit))) {
    const msg = `명시한 설정 경로가 없다: ${explicit}`;
    return { config: {}, source: `⛔ ${msg}`, error: msg };
  }
  const path = findConfigPath(explicit);
  if (!path) return { config: {}, source: '(설정 없음 — 내장 레지스트리)' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (e) {
    // ⛔⭐ 12차 리뷰 — 여기 catch 가 «검증이 던진 것»까지 삼켜 「못 읽었다」로 ***오진***했다.
    //   파일은 멀쩡히 읽혔는데 사람은 권한·JSON 문법을 뒤지게 된다. ⇒ 파싱만 이 안에 둔다.
    // ⛔ 조용히 무시하지 않는다 — 「설정을 썼는데 안 먹는다」가 가장 비싼 침묵이다.
    // ⛔⭐ 7차 리뷰 — 종전엔 호출자가 `source.startsWith('⛔')` 로 «문면»을 보고 실패를 알았다.
    //   문면은 바뀐다. 실패는 «칸»으로 준다 — 새 호출자가 조용히 내장 레지스트리로 계획하지 않게.
    return { config: {}, source: `⛔ ${path} 를 못 읽었다 — ${(e as Error).message}`,
             error: `${path} 를 못 읽었다 — ${(e as Error).message}` };
  }

  // ⛔ 파싱 성공 ≠ 계약 충족. 「못 읽었다」와 「계약과 다르다」는 ***다른 진단***이다.
  const errs = validateConfig(parsed);
  if (errs.length > 0) {
    const msg = `${path} 의 내용이 계약과 다르다 — ${errs.join(' · ')}`;
    return { config: {}, source: `⛔ ${msg}`, error: msg };
  }
  return { config: parsed as VideoToolsConfig, source: path };
}

/** 설정이 내장 능력을 «덮어» 잃게 만든 것. ⛔ 조용히 잃지 않기 위한 값이다. */
export interface ShadowedCapability {
  readonly capability: string;
  readonly lostImpls: readonly string[];
}

/**
 * ⛔⭐ 9차 리뷰 — 「한 번에 한 호출만 유효」를 «문면으로» 못 박았던 자리를 «구조로» 바꾼다.
 *   8차에 나는 「호출자가 하나뿐이라 보류」라고 적었는데, 그것은 ***지금 안 깨진다***는 말이지
 *   ***안 깨진다***는 말이 아니다. 전역 가변 상태는 두 번째 호출자가 생기는 날 조용히 틀린다.
 *   ⇒ 반환값에 같이 실어 보낸다. 전역 칸은 «없앤다».
 */
export interface EffectiveCapabilities {
  readonly capabilities: readonly Capability[];
  /** ⛔ 설정이 내장 구현을 «가려» 잃게 만든 것. 비어 있지 않으면 사람에게 보여야 한다. */
  readonly shadowed: readonly ShadowedCapability[];
}

/** 내장 레지스트리 ⊕ 설정 → «유효» 레지스트리. */
export function effectiveCapabilities(cfg: VideoToolsConfig): readonly Capability[] {
  return effectiveCapabilitiesWithShadowed(cfg).capabilities;
}

export function effectiveCapabilitiesWithShadowed(cfg: VideoToolsConfig): EffectiveCapabilities {
  const shadowed: ShadowedCapability[] = [];
  const byId = new Map<string, { id: string; what: string; impls: Impl[] }>(
    CAPABILITIES.map((c) => [c.id, { id: c.id, what: c.what, impls: [...c.impls] }]),
  );

  // ① 새 능력 — ⛔ 기존 id 를 덮으면 «내장 구현이 통째로 사라진다».
  //   📏 실측: capabilities.encode 를 선언하니 ffmpeg-encode 가 조용히 없어졌다.
  //   ⇒ 덮은 사실을 «값으로» 남긴다. 호출부가 그것을 화면에 낸다(조용히 잃지 않는다).
  for (const [id, spec] of Object.entries(cfg.capabilities ?? {})) {
    const prev = byId.get(id);
    if (prev) {
      shadowed.push({ capability: id, lostImpls: prev.impls.map((i) => i.id) });
    }
    byId.set(id, { id, what: spec.what, impls: [...spec.impls] });
  }

  // ② impl 덮어쓰기·추가
  for (const [implId, patch] of Object.entries(cfg.impls ?? {})) {
    let placed = false;
    for (const cap of byId.values()) {
      const i = cap.impls.findIndex((x) => x.id === implId);
      if (i >= 0) {
        // ⛔ 6차 리뷰(should-fix) — `...patch` 를 통째로 펴면 설정이 `id` 를 바꿔 넣을 수 있고,
        //   그러면 «맵의 키»와 «impl 의 id»가 갈린다(조용히). id 는 설정이 못 건드린다.
        const { id: _ignoredId, ...rest } = patch as Partial<Impl> & { id?: string };
        if (_ignoredId !== undefined && _ignoredId !== implId) {
          console.error(`⛔ 설정이 impl '${implId}' 의 id 를 '${_ignoredId}' 로 바꾸려 한다 — 무시한다`);
        }
        cap.impls[i] = { ...cap.impls[i], ...rest, id: implId } as Impl;
        placed = true;
      }
    }
    if (!placed && patch.capability) {
      const cap = byId.get(patch.capability);
      // ⛔ 새 impl 은 probe·tier 가 «있어야» 한다 — 없으면 「있다고 치는」 칸이 생긴다.
      if (cap && patch.probe && patch.tier) {
        // ⛔ 실측(리뷰 지적 2026-09-22): provider·quotaProbe·hasFreeQuota 를 «버리고» 있었다.
        //   ⇒ 설정으로 넣은 과금 출처가 정책(--provider-order · 무료쿼터 우선)에서 «조용히» 빠진다.
        cap.impls.push({ id: implId, tier: patch.tier, probe: patch.probe,
          ...(patch.unitCost ? { unitCost: patch.unitCost } : {}),
          ...(patch.provider ? { provider: patch.provider } : {}),
          ...(patch.quotaProbe ? { quotaProbe: patch.quotaProbe } : {}),
          ...(patch.hasFreeQuota !== undefined ? { hasFreeQuota: patch.hasFreeQuota } : {}),
          ...(patch.note ? { note: patch.note } : {}) } as Impl);
      }
    }
  }
  return { capabilities: [...byId.values()], shadowed };
}

/** 시작용 설정 — `--init` 이 쓴다. */
export const STARTER_CONFIG = {
  _comment: '영상 도구 설정 — 내장 레지스트리를 «덮는다». 없어도 동작한다.',
  prefer: 'free',
  machines: {
    local: { detect: true, note: '이 기계 — 실제로 잰다' },
    'client-no-paid': {
      detect: false,
      have: ['ffmpeg-edl', 'ffmpeg-ass', 'ffmpeg-encode', 'ffmpeg-audio', 'ffmpeg-lut',
             'imagemagick', 'sips', 'blender-cli', 'whisper-cli', 'macos-say', 'yt-dlp'],
      note: 'AX 기본 가정 — 유료 앱이 하나도 없는 고객 기계',
    },
    'client-affinity': {
      detect: false,
      have: ['ffmpeg-edl', 'ffmpeg-ass', 'ffmpeg-encode', 'ffmpeg-audio',
             'imagemagick', 'affinity', 'blender-cli', 'macos-say'],
      note: '구독 없이 «한 번 사는» 앱만 있는 고객 — Affinity 는 여기 산다',
    },
  },
  impls: {
    affinity: {
      _comment: '경로가 다르면 여기서 덮는다 (v2 는 앱이 셋으로 갈려 있다)',
      probe: { kind: 'path', value: '/Applications/Affinity.app' },
    },
  },
} as const;
