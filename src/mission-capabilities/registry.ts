import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export type CapabilityProbeResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      repairHint: { paths: readonly string[]; what: string };
    };

export interface CapabilityProbeContext {
  authorityRoot?: string;
}

export interface CapabilityProvider {
  id: string;
  probe(context?: CapabilityProbeContext): Promise<CapabilityProbeResult>;
}

/**
 * ⭐ 능력 id 는 «경로 규칙»이다 — `<도메인>.<능력>` → `src/mission-capabilities/<도메인>/<능력>.ts`.
 * ⛔ 매핑 테이블을 두지 않는다(RFC-composite-loop-agent-and-mission-blueprint §4⑵ ·
 *   *"규칙이 곧 조회다 · 매핑 테이블을 두지 않는다(그 테이블이 또 늙는다)"*).
 * 📌 같은 규칙을 `scripts/mission-request-judge.ts` 가 «이미» 쓴다 — 이 파일은 그 규칙을 런타임에 맞춘다.
 *
 * ⚠️ 경로 조립 «전»에 거른다 — `..` · `/` · 대문자가 든 id 는 파일 경로를 만들지 않는다(디렉토리 탈출 방지).
 */
const CAPABILITY_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

const CAPABILITY_ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * 「«내가 물은 그» 모듈이 없다」만 참.
 * ⛔ `code` 만 보면 «있는 provider 안에서» 빠진 의존성을 import 해 난 ERR_MODULE_NOT_FOUND 까지 삼킨다(리뷰 4R must-fix).
 *   ⇒ 오류가 실어 오는 `specifier` 가 ***내가 요청한 그것과 같을 때만*** 「없다」로 읽는다.
 * 📏 실측(bun 1.3.12): 대상 부재는 specifier='./<도메인>/<능력>.js', 내부 의존성 부재는 그 «의존성의» specifier 가 온다.
 */
/** 파일·디렉토리가 «없다»만 참 — 권한·I/O 오류는 «거짓»이라 그대로 올라간다. */
function isNotFound(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT';
}

function isRequestedModuleMissing(error: unknown, specifier: string): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown; specifier?: unknown };
  const looksMissing = candidate.code === 'ERR_MODULE_NOT_FOUND' || candidate.name === 'ResolveMessage';
  if (!looksMissing) return false;
  // ⛔ specifier 를 «못 읽으면» 삼키지 않는다 — 「모르겠다」를 「없다」로 접지 않는다.
  return candidate.specifier === specifier;
}

function isCapabilityProvider(value: unknown, expectedId?: string): value is CapabilityProvider {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; probe?: unknown };
  if (typeof candidate.id !== 'string' || typeof candidate.probe !== 'function') return false;
  return expectedId === undefined || candidate.id === expectedId;
}

/** id 하나를 규칙으로 해석한다. 모양이 틀렸거나 파일이 없거나 default export 가 아니면 undefined. */
export async function resolveCapabilityProvider(id: string): Promise<CapabilityProvider | undefined> {
  if (!CAPABILITY_ID.test(id)) return undefined;
  const cut = id.indexOf('.');
  const specifier = `./${id.slice(0, cut)}/${id.slice(cut + 1)}.js`;
  let module: { default?: unknown };
  try {
    module = await import(specifier) as { default?: unknown };
  } catch (error) {
    // ⛔⭐ 「그 파일이 «없다»」와 「있는데 «못 읽었다»」는 다른 값이다.
    //   모든 예외를 undefined 로 삼키면 의존성 깨짐·초기화 오류가 ***「능력 없음」으로 조용히 바뀐다*** —
    //   정적 import 가 «드러내던» 운영 오류를 이 규칙 해석이 숨기게 된다(리뷰 3R must-fix).
    //   📏 실측(2026-08-31 · bun 1.3.12): 없는 모듈은 code='ERR_MODULE_NOT_FOUND'(name='ResolveMessage'),
    //     평가 중 던진 모듈은 «그 모듈 자신의» Error 가 그대로 온다.
    if (isRequestedModuleMissing(error, specifier)) return undefined;
    throw error;
  }
  return isCapabilityProvider(module.default, id) ? module.default : undefined;
}

/**
 * ⭐ 카탈로그를 «디렉토리에서 찾는다» — 손으로 나열한 목록이 없다.
 * ⛔ 그래도 이 이름(`capabilityProviders`)은 «유지»한다: 시험 넷과 블루프린트 로더가 동기로 쓴다.
 *   「목록을 손으로 안 쓴다」와 「그 export 를 지운다」는 다른 값이다 — 후자는 소비자를 조용히 깬다.
 */
export async function discoverCapabilityProviders(): Promise<readonly CapabilityProvider[]> {
  const found: CapabilityProvider[] = [];
  // ⛔ 같은 축: 「디렉토리가 «없다»」와 「있는데 «못 읽었다»(권한·I/O)」는 다른 값이다.
  //   후자를 빈 목록으로 바꾸면 ***「능력 0개」로 보이고*** 아무도 그 원인을 못 본다.
  let domains: string[];
  try {
    domains = readdirSync(CAPABILITY_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if (isNotFound(error)) return found;
    throw error;
  }
  for (const domain of domains) {
    let files: string[];
    try {
      // ⛔ `.ts` 만 훑고 `.js` 를 import 하면 «컴파일된 산출물»에서 카탈로그가 조용히 빈다(리뷰 지적).
      //   ⇒ 두 확장자를 다 훑고, 같은 능력이 둘 다 있으면 한 번만 센다.
      files = readdirSync(join(CAPABILITY_ROOT, domain))
        .filter(name => (name.endsWith('.ts') || name.endsWith('.js'))
          && !name.endsWith('.test.ts') && !name.endsWith('.test.js') && !name.endsWith('.d.ts'))
        .sort();
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const seen = new Set<string>();
    for (const file of files) {
      const stem = file.replace(/\.(ts|js)$/, '');
      if (seen.has(stem)) continue;
      seen.add(stem);
      const provider = await resolveCapabilityProvider(`${domain}.${stem}`);
      if (provider) found.push(provider);
    }
  }
  return found;
}

/** ⚠️ top-level await — 이 모듈을 정적으로 import 해도 이 시점엔 채워져 있다. */
export const capabilityProviders: readonly CapabilityProvider[] = await discoverCapabilityProviders();

export async function probeCapability(id: string, context?: CapabilityProbeContext): Promise<CapabilityProbeResult | undefined> {
  return (await resolveCapabilityProvider(id))?.probe(context);
}
