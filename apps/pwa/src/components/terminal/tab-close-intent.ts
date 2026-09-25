export type OwnerRunUsage = 'running' | 'terminated-live-owner' | 'no-run-id' | 'unknown';
export type TabCloseAction = 'remove-local' | 'terminate';

export interface TerminateConfirmation {
  title: string;
  message: string;
}

export function normalizeOwnerRunUsage(value: unknown): OwnerRunUsage {
  return value === 'running'
    || value === 'terminated-live-owner'
    || value === 'no-run-id'
    || value === 'unknown'
    ? value
    : 'unknown';
}

export function tabCloseAction(action: TabCloseAction): { action: TabCloseAction; sendsDestroy: boolean } {
  return { action, sendsDestroy: action === 'terminate' };
}

export function terminateConfirmation(ownerRunUsage: unknown): TerminateConfirmation {
  switch (normalizeOwnerRunUsage(ownerRunUsage)) {
    case 'running':
      return {
        title: '터미널을 끝낼까요?',
        message: '실행 중인 런이 이 터미널을 사용하고 있습니다. 끝내면 터미널과 그 프로세스가 종료됩니다.',
      };
    case 'terminated-live-owner':
      return {
        title: '터미널을 끝낼까요?',
        message: '소유 런은 종료됐지만 이 터미널은 아직 남아 있습니다. 끝내면 터미널과 그 프로세스가 종료됩니다.',
      };
    case 'no-run-id':
      return {
        title: '터미널을 끝낼까요?',
        message: '이 터미널에는 소유 런 정보가 없습니다. 끝내면 터미널과 그 프로세스가 종료됩니다.',
      };
    case 'unknown':
      return {
        title: '터미널을 끝낼까요?',
        message: '이 터미널의 사용 상태를 확인할 수 없습니다. 아무도 쓰지 않는다고 단정할 수 없으며, 끝내면 터미널과 그 프로세스가 종료됩니다.',
      };
  }
}
