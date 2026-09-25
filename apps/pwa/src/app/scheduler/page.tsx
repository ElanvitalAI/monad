// Scheduler surface — 2026-07-08 부활 (registry 기반).
//
// 2026-05-11 (v2.2-6) 에 "스케줄 = workflow trigger 로 통합" 이라며 `/workflows`
// 로 redirect 시켰으나, 실제 예약(투자 크론 등)은 workflow YAML 이 아니라
// `schedule_registry` 에 살아 workflow 화면에서 안 보이는 공백이 있었다. 모든
// 예약의 단일 인지 지점인 schedule-registry(crontab · 데몬 내부 · workflow
// trigger 미러 흡수)를 그대로 뷰로 되살린다. redirect stub → SchedulerPanel.

'use client';

import { SchedulerPanel } from '@/components/scheduler/SchedulerPanel';

export default function SchedulerPage(): React.ReactNode {
  return <SchedulerPanel />;
}
