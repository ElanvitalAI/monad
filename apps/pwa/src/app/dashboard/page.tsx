/** R4 (2026-07-07) — `/dashboard` route entry (organic-signal-engine). */

import { DashboardTabs } from '@/components/dashboard/DashboardTabs';

export const metadata = {
  title: 'Dashboard · elanous',
};

export default function DashboardPage() {
  return <DashboardTabs />;
}
