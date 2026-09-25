/**
 * Relative date range resolver.
 *
 * Supports:
 *   Absolute:  2025-01-01
 *   Relative:  -1d, -5d, -1w, -2w, -1m, -3m, -6m, -1q, -2q, -1y, -2y, -5y, -10y
 *   Named:     today, yesterday, ytd, mtd, qtd
 */

// 2026-07-24 — 로컬 달력으로 포맷한다.
//
// 종전 `toISOString().slice(0,10)` 은 **UTC** 날짜였는데, 아래 startOfYear/Quarter/
// Month 와 sub() 는 전부 `new Date(y, m, d)` / `setDate()` 즉 **로컬 달력** 산술이다.
// 로컬 자정 Date 를 UTC 로 직렬화하면 UTC+9(KST)에서는 무조건 전날이 나온다:
//   ytd → 2025-12-31 (2026-01-01 이어야 함)  ← 시각 무관 **상시** 오류
//   mtd/qtd → 전월/전분기 말일               ← 동일
//   today/-Nd → KST 00:00~09:00 구간에서만 하루 밀림
// 산술이 로컬이므로 포맷도 로컬로 맞추는 것이 최소·정합 수정이다.
// (monad 측 계약: src/time/format.ts — 저장은 UTC, 표시·날짜키는 사용자 시간대)
function fmt(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function today(): Date {
  return new Date();
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sub(d: Date, unit: string, n: number): Date {
  const r = new Date(d);
  switch (unit) {
    case 'd': r.setDate(r.getDate() - n); break;
    case 'w': r.setDate(r.getDate() - n * 7); break;
    case 'm': r.setMonth(r.getMonth() - n); break;
    case 'q': r.setMonth(r.getMonth() - n * 3); break;
    case 'y': r.setFullYear(r.getFullYear() - n); break;
  }
  return r;
}

export function resolveDate(expr: string | undefined): string | undefined {
  if (!expr) return undefined;
  const s = expr.trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}$/.test(s)) return s;

  const now = today();
  if (s === 'today') return fmt(now);
  if (s === 'yesterday') return fmt(sub(now, 'd', 1));
  if (s === 'ytd' || s === '-ytd') return fmt(startOfYear(now));
  if (s === 'qtd' || s === '-qtd') return fmt(startOfQuarter(now));
  if (s === 'mtd' || s === '-mtd') return fmt(startOfMonth(now));

  const rel = s.match(/^-?(\d+)(d|w|m|q|y)$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    return fmt(sub(now, unit, n));
  }

  return expr;
}

export function resolveDateRange(from: string | undefined, to: string | undefined): { from?: string; to?: string } {
  const resolvedFrom = resolveDate(from);
  let resolvedTo = resolveDate(to);

  if (resolvedFrom && !resolvedTo && from && !/^\d{4}(-\d{2}-\d{2})?$/.test(from.trim())) {
    resolvedTo = fmt(today());
  }

  return { from: resolvedFrom, to: resolvedTo };
}
