export interface DashboardYoloPolicyBootDeps {
  enabled: boolean;
  setPolicy: (policy: { mode: 'unsupervised' }) => void;
  pushWarningLine: (message: string) => void;
  pushMutedLine: (message: string) => void;
}

export function bootDashboardYoloPolicy(
  deps: DashboardYoloPolicyBootDeps,
): void {
  if (!deps.enabled) return;
  deps.setPolicy({ mode: 'unsupervised' });
  deps.pushWarningLine('[yolo] code-edit policy: UNSUPERVISED — every Edit/Write applies without approval.');
  deps.pushMutedLine('[yolo] flip back with /code-edit policy ask-edit');
}
