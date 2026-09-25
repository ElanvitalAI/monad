import { describe, expect, test } from 'bun:test';
import { goalTitleFromDocument } from '../src/self-implement/seams.js';

// 🪞 같은 자리에서 «세 번» 샜다 — PR 제목(#10518) · goalTitle(#10586) · 그리고 이 판.
//   뿌리는 매번 같다: ***「위치」로 뽑고 「예외 목록」으로 막았다.*** 목록은 언제나 한 발 뒤에 있다.
describe('goalTitleFromDocument — «머리 H1» 만 제목이다', () => {
  test('머리에 오는 H1 을 제목으로 낸다 (frontmatter 와 앞 공백을 건너뛴다)', () => {
    expect(goalTitleFromDocument('# GOAL — 로그에 시간 창을 준다\n\n본문')).toBe('GOAL — 로그에 시간 창을 준다');
    expect(goalTitleFromDocument('\n\n#   여백이 있어도   된다  \n')).toBe('여백이 있어도 된다');
    expect(goalTitleFromDocument('---\ntopic: x\n---\n# 프론트매터 뒤의 제목\n')).toBe('프론트매터 뒤의 제목');
  });

  // ⛔ 이것이 이 판의 본체다 — 실제 골 문서의 «지배적» 모양이고, 종전 판은 여기서 절 제목을 냈다.
  test('절 제목은 제목이 «아니다» — 골 문서의 실제 머리 모양', () => {
    const realGoalHead = [
      '대상 경로: src/a.ts · src/a.test.ts',
      '- GoalId: 952a3c5faa5f2553',
      '- GoalType: implement',
      '',
      '## 발사 전 분해 권고',
      '- 상태: measured',
      '',
      '## RULES',
      '- 규칙',
    ].join('\n');
    expect(goalTitleFromDocument(realGoalHead)).toBeUndefined();
  });

  test('H2 이하는 머리에 있어도 제목이 아니다', () => {
    expect(goalTitleFromDocument('## RULES\n본문')).toBeUndefined();
    expect(goalTitleFromDocument('### 왜 이 골인가\n본문')).toBeUndefined();
    expect(goalTitleFromDocument('#### 세부 절\n본문')).toBeUndefined();
    expect(goalTitleFromDocument('##### 더 깊은 절\n본문')).toBeUndefined();
    expect(goalTitleFromDocument('###### 가장 깊은 절\n본문')).toBeUndefined();
  });

  test('머리 H1 이라도 표지 낱말이면 제목이 아니다', () => {
    expect(goalTitleFromDocument('# 불변식\n본문')).toBeUndefined();
    expect(goalTitleFromDocument('# PROBLEM\n본문')).toBeUndefined();
  });

  // ⛔ CommonMark — 앞 공백 0~3칸까지만 제목이다. 4칸 이상·탭은 «들여쓴 코드 블록»이다.
  test('4칸 이상 들여쓴 `#` 줄은 제목이 아니라 코드 블록이다', () => {
    expect(goalTitleFromDocument('   # 세 칸까지는 제목이다\n')).toBe('세 칸까지는 제목이다');
    expect(goalTitleFromDocument('    # 코드 예시\n')).toBeUndefined();
    expect(goalTitleFromDocument('\t# 탭으로 들여썼다\n')).toBeUndefined();
    expect(goalTitleFromDocument('        # 깊게 들여썼다\n')).toBeUndefined();
  });

  // ⛔ CommonMark — `# 제목 ###` 의 닫는 시퀀스는 제목의 «일부가 아니다».
  test('닫는 ATX 시퀀스를 벗기되, 붙어 있는 `#` 는 내용으로 둔다', () => {
    expect(goalTitleFromDocument('# 실제 제목 ###\n')).toBe('실제 제목');
    expect(goalTitleFromDocument('# 실제 제목 #   \n')).toBe('실제 제목');
    expect(goalTitleFromDocument('# C# 로 짠다\n')).toBe('C# 로 짠다');      // 공백 없이 붙은 것은 내용이다
    expect(goalTitleFromDocument('# 꼬리#만\n')).toBe('꼬리#만');
    expect(goalTitleFromDocument('# ###\n')).toBeUndefined();               // 남는 것이 없으면 제목이 아니다
  });

  test('제목이 아예 없는 문서는 undefined — 「모른다」를 지어내지 않는다', () => {
    expect(goalTitleFromDocument('제목 없는 본문만 있다')).toBeUndefined();
    expect(goalTitleFromDocument('')).toBeUndefined();
    expect(goalTitleFromDocument('#없는공백\n')).toBeUndefined();   // `#` 뒤 공백이 없으면 제목이 아니다
  });
});
