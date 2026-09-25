import type { DaemonClient } from './daemon-client';

export type TaskStatus =
  | 'backlog'
  | 'blocked'
  | 'scheduled'
  | 'ready'
  | 'running'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'superseded';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskBoardCard {
  id: string;
  title: string;
  dryRun: boolean;
  dryRunOutcome?: 'done' | 'failed';
  status: TaskStatus;
  priority: TaskPriority;
  surfaceKind: string;
  goalSlug?: string;
  featureName?: string;
  scheduleText?: string;
  schedulerJobId?: string;
  createdAt: number;
  updatedAt: number;
  attempt: number;
  maxRetries: number;
  notesTail: string[];
  acceptanceCount: number;
  lastExecutionStatus?: string;
  /** Cascade-zyu Z0 (2026-05-12) — when set, the card renders an
   *  "Open in showroom" jump that opens the linked session. */
  showroomSessionId?: string;
  // ── 미션/아크 연관(2026-07-14) — 미션이 빌드한 것 = 태스크 통합 가시성. ──
  missionTitle?: string;
  arcId?: string;
  arcName?: string;
  arcIndex?: number;
  phaseIndexInArc?: number;
  arcTotalPhases?: number;
  arcStatus?: string;
  /** 빌드 중(running) 페이즈의 실 SE 빌드(2026-07-14). */
  build?: { buildId: string; backend: string; status: string; attemptSeq: number; maxTurns?: number };
}

export interface TaskExecution {
  id: string;
  taskId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: string;
  surface: { kind: string };
  surfaceAddress?: string;
  output?: string;
  outputPath?: string;
  error?: { code: string; message: string; stack?: string };
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
  modelId?: string;
}

export interface TaskDetail {
  id: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  title: string;
  description: string;
  surface: { kind: string };
  parentId?: string;
  goalSlug?: string;
  dependsOn: string[];
  triggers?: string[];
  priority: TaskPriority;
  featureName?: string;
  isolation: string;
  maxRetries: number;
  attempt: number;
  timeoutMs?: number;
  status: TaskStatus;
  scheduleText?: string;
  schedulerJobId?: string;
  lastExecutionId?: string;
  acceptance?: { criteria: string[]; checks?: Array<{ kind: string }> };
  reviewVerdicts?: Array<{ passed: boolean; reason: string; timestamp: number }>;
  notes: string[];
  /** Cascade-zyu Z0 (2026-05-12) — see TaskBoardCard.showroomSessionId. */
  showroomSessionId?: string;
}

/** SE 빌드 스냅샷(2026-07-14) — running 페이즈의 실시간 로그 tail + 상태 + diff. */
export interface BuildSnapshotWire {
  build: { buildId: string; backend: string; status: string; attemptSeq: number; prUrl?: string | null };
  logTail: string[];
  diffStat?: { files: number; insertions: number; deletions: number } | null;
}

export class TaskApi {
  constructor(private client: DaemonClient) {}

  /** 빌드 스냅샷(로그 tail 폴링용) — GET /v1/builds/<id>?tail=N. */
  buildSnapshot(buildId: string, tail = 80): Promise<BuildSnapshotWire> {
    return this.client.fetchJson(`/v1/builds/${encodeURIComponent(buildId)}?tail=${tail}`);
  }

  list(): Promise<{
    summary: {
      total: number;
      open: number;
      terminal: number;
      linkedScheduler: number;
      byStatus: Record<string, number>;
      byPriority: Record<string, number>;
    };
    tasks: TaskBoardCard[];
  }> {
    return this.client.fetchJson('/v1/tasks');
  }

  detail(taskId: string): Promise<{
    task: TaskDetail;
    executions: TaskExecution[];
    events: Array<{ kind: string; timestamp: number; taskId?: string }>;
    linkedSchedulerJob?: {
      taskId: string;
      title: string;
      taskMeta?: {
        dryRun?: boolean;
        dryRunOutcome?: 'done' | 'failed';
      };
    } | null;
  }> {
    return this.client.fetchJson(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }
}
