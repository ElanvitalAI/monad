'use client';

// W9d-FU Z13-c · `/morning` route — conversational 4-pane standup.
//
// The route is a thin mount point. Today the digest input is synthesized
// from the current date + an empty run history (so the page renders even
// without daemon-side digest aggregation wired). A future follow-up wires
// `GET /v1/morning-digest/today` so the page receives real overnight runs +
// scheduled upcoming + backlog recommendations.

import { useMemo } from 'react';
import { MorningShowroom } from '@/components/morning/MorningShowroom';

function todayWindow(): { date: string; windowStart: string; windowEnd: string } {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;
  const start = new Date(Date.UTC(yyyy, now.getUTCMonth(), now.getUTCDate() - 1, 22));
  const end = new Date(Date.UTC(yyyy, now.getUTCMonth(), now.getUTCDate(), 8));
  return { date, windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

export default function MorningPage() {
  const request = useMemo(() => {
    const w = todayWindow();
    return {
      date: w.date,
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      runs: [],
      upcoming: [],
      backlogRecommendations: [],
    };
  }, []);
  return <MorningShowroom request={request} />;
}
