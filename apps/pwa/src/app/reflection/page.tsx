/** R6.4 — `/reflection` route entry. */

import { DailyReflectionPanel } from '@/components/reflection/DailyReflectionPanel';
import { ReflectionRouteIntentBeacon } from '@/components/reflection/ReflectionRouteIntentBeacon';

export const metadata = {
  title: 'Reflection · elanous',
};

export default function ReflectionPage() {
  return (
    <>
      <ReflectionRouteIntentBeacon />
      <DailyReflectionPanel />
    </>
  );
}
