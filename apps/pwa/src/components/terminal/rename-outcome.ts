import type { DaemonTerminalRenameResult } from '@/lib/daemon-client';

export function renameOutcomeMessage(result: DaemonTerminalRenameResult): string {
  switch (result.status) {
    case 'success':
      return `PTY 이름을 '${result.name}'(으)로 바꿨습니다.`;
    case 'invalid-name':
      return '이 이름은 사용할 수 없습니다. 다른 이름을 입력해 주세요.';
    case 'unknown-pty':
      return '이 PTY를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.';
    case 'denied':
      return '이 PTY의 이름을 바꿀 권한이 없습니다.';
    case 'failed':
      return 'PTY 이름 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    case 'owner-unreachable':
      return 'PTY 소유 프로세스에 연결할 수 없어 이름을 바꾸지 못했습니다.';
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}
