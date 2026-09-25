/** CV-3 Showroom MVP P1 — `/showroom` route entry.
 *  ([RFC v4](../../../../../내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07`))
 *
 *  D8 — Showroom 은 `/chat` 와 별개의 새 route. clean separation.
 *  /chat 의 mode toggle 보다 URL shareable + sidebar nav 진입이 깔끔.
 */

import { Suspense } from 'react';
import { ShowroomLayout } from '@/components/showroom/ShowroomLayout';

export const metadata = {
  title: 'Showroom · monad',
};

export default function ShowroomPage() {
  // ShowroomLayout uses useSearchParams() at the top level, which
  // forces the static prerender to bail out unless wrapped in
  // Suspense. Without this, `bun run build` fails on /showroom with
  // "useSearchParams() should be wrapped in a suspense boundary".
  return (
    <Suspense fallback={null}>
      <ShowroomLayout />
    </Suspense>
  );
}
