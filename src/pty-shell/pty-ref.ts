// ── PTY 참조 리졸버 (id·닉네임 = 같은 객체의 다른 이름 → 하나의 PTY) ──
//
// 실행 substrate 통합의 주소층. `goto <ref>` 를 크로스-서피스(TUI Virtual Workspace·webterm·dashboard)에서
// 동일하게 푼다. 고유 id(`<kind>_<hex>` 또는 `<kind>-<hex>`)와 닉네임(휴먼 리더블·나중에 기억·접근)은 **같은 PTY 객체의 alias**.
//
// 우선순위: exact id → 닉네임(정확) → id 접두/hex → 닉네임(부분) → kind(유일). 복수 매치 = ambiguous(후보 반환).
// 순수 함수(레지스트리 비의존·테스트 가능). 라이브 바인딩은 registry.resolvePtyLive.

/** PTY 접근 모드 — read(관찰 전용) | write(사람 인터랙션) | auto(컨트롤러/brain 소유·헤드리스 자율). */
export type PtyAccessMode = 'read' | 'write' | 'auto';

/** PTY access-mode 저장값의 런타임 판별 SSOT. IPC/DB 경계의 문자열은 이 검사를 거쳐야 한다. */
export function isPtyAccessMode(value: unknown): value is PtyAccessMode {
  return value === 'read' || value === 'write' || value === 'auto';
}

/** 모드 전환 정책 — locked(전환불가·현 모드 고정. read+locked = write 불가) | open(전환허용·takeover 가능). */
export type PtyTransitionPolicy = 'locked' | 'open';

/**
 * ★ 접근 모드 전환 허용 판정(pure·정책 SSOT). locked 면 다른 모드로 못 감(같은 모드 재설정은 허용).
 *   read+locked→write = 거부(write 불가). auto+locked→write = 거부(보호된 자율·무간섭).
 */
export function canTransitionAccessMode(
  current: PtyAccessMode,
  next: PtyAccessMode,
  policy: PtyTransitionPolicy,
): boolean {
  return policy === 'open' || next === current;
}

export interface PtyRefItem {
  id: string;
  kind: string;
  nickname?: string;
}

export type PtyRefReason =
  | 'exact-id' | 'nickname-exact' | 'id-prefix' | 'nickname-substr' | 'kind' | 'ambiguous' | 'none';

export interface PtyRefResolution {
  /** 유일 확정된 PTY(없으면 null). */
  match: PtyRefItem | null;
  /** 매치/모호 후보들(goto 가 목록 제시에 사용). */
  candidates: PtyRefItem[];
  reason: PtyRefReason;
}

/** PTY ID에서 `_`와 `-` 중 먼저 나타나는 구분자 위치. 콜론은 다른 이름공간이라 인식하지 않는다. */
export function ptyIdSeparatorIndex(id: string): number {
  const underscore = id.indexOf('_');
  const hyphen = id.indexOf('-');
  if (underscore < 0) return hyphen;
  if (hyphen < 0) return underscore;
  return Math.min(underscore, hyphen);
}

/** ★ ref(고유 id 또는 닉네임)를 하나의 PTY 로 해석. 복수면 ambiguous+후보. */
export function resolvePtyRef(ref: string, items: readonly PtyRefItem[]): PtyRefResolution {
  const r = ref.trim().toLowerCase();
  if (!r) return { match: null, candidates: [], reason: 'none' };
  const nick = (it: PtyRefItem): string => (it.nickname ?? '').toLowerCase();
  const hexPart = (id: string): string => { const i = ptyIdSeparatorIndex(id); return i >= 0 ? id.slice(i + 1) : id; };

  const stages: Array<{ reason: PtyRefReason; hits: PtyRefItem[] }> = [
    { reason: 'exact-id', hits: items.filter((it) => it.id.toLowerCase() === r) },
    { reason: 'nickname-exact', hits: items.filter((it) => nick(it) === r) },
    { reason: 'kind', hits: items.filter((it) => it.kind.toLowerCase() === r) },
    { reason: 'id-prefix', hits: items.filter((it) => it.id.toLowerCase().startsWith(r) || hexPart(it.id.toLowerCase()).startsWith(r)) },
    { reason: 'nickname-substr', hits: items.filter((it) => nick(it).length > 0 && nick(it).includes(r)) },
  ];
  for (const s of stages) {
    if (s.hits.length === 1) return { match: s.hits[0]!, candidates: s.hits, reason: s.reason };
    if (s.hits.length > 1) return { match: null, candidates: s.hits, reason: 'ambiguous' };
  }
  return { match: null, candidates: [], reason: 'none' };
}
