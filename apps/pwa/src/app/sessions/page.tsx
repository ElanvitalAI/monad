/** `/sessions` route entry. 라이브 세션 리스트(2026-07-09 · S2).
 *  대화중 세션(CLI·텔레그램) 목록 + 보기/복사/Fork + 자동갱신. 구 스와이프 데크
 *  (SessionsDeckPanel·빈 in-memory 표면)를 on-disk 표면으로 대체.
 */

import { SessionsListPanel } from '@/components/sessions/SessionsListPanel';

export const metadata = {
  title: 'Sessions · monad',
};

export default function SessionsPage() {
  return <SessionsListPanel />;
}
