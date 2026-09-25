'use client';

// ── /intake 리다이렉트 (narrow-waist V3 · 2026-07-09) ──────────────────────
//
// 대표 결정(§8): intake 탭 즉시 제거. "intake=장소"가 아니라 "말하면 미션이
// 된다"는 보이지 않는 게이트로 흡수. 포착은 Autopilot Missions 골던지기 컴포저
// (PWA) + 텔레그램 "미션:" 마커. 옛 /intake 링크/북마크는 /autopilot 으로 안내.
// 설계: 내부 문서 `DESIGN-intent-narrow-waist-2026-07-09` §3·§8.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function IntakeRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace('/autopilot'), 1200);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="mx-auto max-w-lg space-y-3 p-8 text-center" data-testid="intake-redirect">
      <h1 className="text-lg font-semibold">Intake → Autopilot 로 이전되었습니다</h1>
      <p className="text-sm text-muted-foreground">
        이제 포착은 별도 탭이 아니라 <b>&ldquo;말하면 미션이 된다&rdquo;</b> 입니다.
        Autopilot Missions 의 <b>골 던지기</b> 컴포저, 또는 텔레그램에서
        <code className="mx-1 rounded bg-muted px-1">미션:</code> 마커로 소망을 던지세요.
      </p>
      <Link href="/autopilot" className="inline-block text-sm text-primary hover:underline">
        지금 Autopilot 열기 →
      </Link>
    </div>
  );
}
