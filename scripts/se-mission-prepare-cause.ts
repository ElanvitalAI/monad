import { debug } from '../src/debug/log.js';

const SCHEMA_VIOLATION_RE = /VALIDATION_FAILED|PARSE_FAILED|schema violation/i;
/** 확인된 게이트웨이 기전만. ETIMEDOUT·network·abort 는 여기 안 들어간다. */
// ⛔ 숫자만으로는 «상태 코드»가 아니다 — 🩸 2026-09-23: `took 504ms` 가 게이트웨이 오류로 분류됐다.
//   ⇒ HTTP 상태를 «말하는» 문맥(HTTP/status/code 앞말 · 표준 사유구 뒷말)이 있을 때만 코드로 읽는다.
const GATEWAY_CONFIRMED_RE = /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?:Code)?|code)\s*[:=]?\s*(?:5\d\d|429)\b|\b(?:5\d\d|429)\s+(?:Bad Gateway|Service Unavailable|Gateway Time-?out|Internal Server Error|Too Many Requests)\b|Cloudflare|\bgateway\b/i;

export type DecomposeFailureLabel =
  | '스키마 위반(sol 형식 실패)'
  | '게이트웨이 오류(재시도 소진)'
  | '원인 미분류';

/** 확인된 기전만 이름으로 댄다. 그 외(시간 초과·네트워크·중단…)는 «원인 미분류». */
export function classifyDecomposeFailure(decomposeError: string): {
  label: DecomposeFailureLabel;
  basis: 'schema-violation' | 'gateway-confirmed' | 'unclassified';
} {
  if (SCHEMA_VIOLATION_RE.test(decomposeError)) {
    return { label: '스키마 위반(sol 형식 실패)', basis: 'schema-violation' };
  }
  if (GATEWAY_CONFIRMED_RE.test(decomposeError)) {
    return { label: '게이트웨이 오류(재시도 소진)', basis: 'gateway-confirmed' };
  }
  return { label: '원인 미분류', basis: 'unclassified' };
}

export type DecomposeCauseHitl = {
  text: string;
  notified: true;
  observed: { errorPrefix: string; label: DecomposeFailureLabel; basis: 'schema-violation' | 'gateway-confirmed' | 'unclassified' };
};

/** 분해 실패 HITL 문구를 만들고 통지·관측을 남긴다. 미확인 원인은 «원인 미분류». */
export function reportDecomposeFailureHitl(input: {
  decomposeError: string;
  model: string;
  opusModel: string;
  notify: (text: string) => void;
  log?: (category: string, event: string, data: Record<string, unknown>) => void;
}): DecomposeCauseHitl {
  const classified = classifyDecomposeFailure(input.decomposeError);
  const errorPrefix = input.decomposeError.slice(0, 90);
  const observed = { errorPrefix, label: classified.label, basis: classified.basis };
  try {
    (input.log ?? ((category, event, data) => debug.log(category, event, data)))(
      'mission.prepare.decompose-cause',
      'classified',
      observed,
    );
  } catch { /* fail-soft — 관측 실패는 통지를 막지 않는다 */ }
  const text = `🧩 골 분해 실패 — Codex(${input.model}) ${classified.label}.\n\`${errorPrefix}\`\n\n🧠 Opus(${input.opusModel}·유료)로 재분해할까요? (다른 모델이면 성공 가능)`;
  input.notify(text);
  return { text, notified: true, observed };
}
