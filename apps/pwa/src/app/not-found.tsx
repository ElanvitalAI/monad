'use client';

import { usePathname } from 'next/navigation';
import { RouteGuidanceList } from '@/components/welcome/WelcomeHome';

export default function NotFound() {
  const pathname = usePathname();
  const missingPath = pathname || '알 수 없는 주소';

  return (
    <main data-testid="not-found" className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 px-6 py-12 sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">elanous PWA</p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">여기엔 없습니다</h1>
          <p className="text-sm text-muted-foreground">
            <code>{missingPath}</code> 주소는 이 앱에 없습니다. 아래에서 지금 갈 수 있는 곳을 선택하거나 참고 주소의 사유를 확인하세요.
          </p>
        </header>
        <RouteGuidanceList ariaLabel="이동 가능한 주소와 참고 주소" />
      </div>
    </main>
  );
}
