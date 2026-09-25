import { describe, expect, test } from 'bun:test';

import { renameOutcomeMessage } from './rename-outcome';

describe('renameOutcomeMessage', () => {
  test.each([
    [{ status: 'success', id: 'pty-1', name: 'research' }, "PTY 이름을 'research'(으)로 바꿨습니다."],
    [{ status: 'invalid-name' }, '이 이름은 사용할 수 없습니다. 다른 이름을 입력해 주세요.'],
    [{ status: 'unknown-pty' }, '이 PTY를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.'],
    [{ status: 'denied' }, '이 PTY의 이름을 바꿀 권한이 없습니다.'],
    [{ status: 'failed' }, 'PTY 이름 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.'],
    [{ status: 'owner-unreachable' }, 'PTY 소유 프로세스에 연결할 수 없어 이름을 바꾸지 못했습니다.'],
  ] as const)('maps %o to its explicit user feedback', (result, expectedMessage) => {
    expect(renameOutcomeMessage(result)).toBe(expectedMessage);
  });

  test('keeps all six explicit feedback messages distinct', () => {
    const messages = [
      "PTY 이름을 'research'(으)로 바꿨습니다.",
      '이 이름은 사용할 수 없습니다. 다른 이름을 입력해 주세요.',
      '이 PTY를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.',
      '이 PTY의 이름을 바꿀 권한이 없습니다.',
      'PTY 이름 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      'PTY 소유 프로세스에 연결할 수 없어 이름을 바꾸지 못했습니다.',
    ];

    expect(new Set(messages).size).toBe(6);
  });

  test('does not describe a missing PTY as an invalid name', () => {
    expect(renameOutcomeMessage({ status: 'unknown-pty' })).toContain('찾을 수 없습니다');
    expect(renameOutcomeMessage({ status: 'unknown-pty' })).not.toContain('사용할 수 없습니다');
  });
});
