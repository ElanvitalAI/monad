import { describe, expect, test } from 'bun:test';

import { detectSelfQuestionSubjectViolations, lintGoalFile } from './goal-author.js';

const goalSelfInquiry = '그 경로가 essential 에서 그려지는지 이 골이 확인해야 한다. 안 그려지면 다른 길을 쓴다.';
const receiverInquiry = '검증할 수 없는 조각이 남으면 받은 쪽이 다시 조사해야 하고, 그 조사가 다음 조각의 뿌리가 된다.';
const humanInquiry = '실제 착지에서 그 줄이 나오는지는 착지 뒤에 사람이 확인한다.';
const goalAuthorInquiry = '이 골을 낸 쪽이 착지 뒤에 라이브 런으로 확인한다.';
const goalSelfInquiryWithTargetSynonym = '이 목표가 확인해야 합니다.';
const genericGoalMention = '목표가 확인해야 합니다.';

const selfQuestionFindings = (document: string) => lintGoalFile(document, 'main').filter((finding) => finding.tag === 'self-question-subject');

describe('detectSelfQuestionSubjectViolations', () => {
  test('detects only the goal-self inquiry from the exact authored sentences', () => {
    expect(detectSelfQuestionSubjectViolations(goalSelfInquiry)).toEqual([
      { clause: '그 경로가 essential 에서 그려지는지 이 골이 확인해야 한다', subject: '이 골' },
    ]);
    expect(detectSelfQuestionSubjectViolations(receiverInquiry)).toEqual([]);
    expect(detectSelfQuestionSubjectViolations(humanInquiry)).toEqual([]);
    expect(detectSelfQuestionSubjectViolations(goalAuthorInquiry)).toEqual([]);
  });

  test('detects both supported goal-self subject forms without matching generic goal mentions', () => {
    expect(detectSelfQuestionSubjectViolations(goalSelfInquiry)).toEqual([
      { clause: '그 경로가 essential 에서 그려지는지 이 골이 확인해야 한다', subject: '이 골' },
    ]);
    expect(detectSelfQuestionSubjectViolations(goalSelfInquiryWithTargetSynonym)).toEqual([
      { clause: '이 목표가 확인해야 합니다', subject: '이 목표' },
    ]);
    expect(detectSelfQuestionSubjectViolations(genericGoalMention)).toEqual([]);
  });

  test('emits one clear, non-blocking WARN and observable count for the goal-self inquiry', () => {
    const findings = lintGoalFile(goalSelfInquiry, 'main');

    expect(selfQuestionFindings(goalSelfInquiry)).toEqual([{
      level: 'WARN',
      tag: 'self-question-subject',
      message: 'inquiry or verification clause must not use the goal itself as its subject: 그 경로가 essential 에서 그려지는지 이 골이 확인해야 한다',
    }]);
    expect(findings.selfQuestionSubjectViolationCount).toBe(1);
    expect(selfQuestionFindings(goalSelfInquiry)).not.toContainEqual(expect.objectContaining({ level: 'ERROR' }));
  });

  test('does not warn for the exact received-side, human, or goal-author inquiries', () => {
    for (const document of [receiverInquiry, humanInquiry, goalAuthorInquiry]) {
      const findings = lintGoalFile(document, 'main');
      expect(selfQuestionFindings(document)).toEqual([]);
      expect(findings.selfQuestionSubjectViolationCount).toBe(0);
    }
  });
});
