// 실행/변경 의도 신호 — 배틀쉽 웜-preload 스위치 (2026-07-27 · Phase 1)
//
// 발단(실측): 자연어를 데몬(L2)에 던졌더니
//   `deferred:[SelfImplement,RunDevHarness,SolveMission] · unhydratable:[] · warmPreloaded:0`
// 이 나왔다. 배틀쉽에 `intentScope:'coding'` 태그는 **이미 붙어 있었는데** 그걸 켜 줄
// 신호가 없어 영원히 name-only 로 남았고, 에이전트는 조사만 하다 "도구 한도" 라며
// 끝냈다(툴 14개 중 ToolSearch·SelfImplement **0건**).
//
// ⚠️ 이 신호는 **일부러 좁다.** 다른 intent 는 오탐이 나도 boost 를 살짝 밀 뿐이지만,
//    이건 무거운 스키마 8종(EnterWorktree·SelfImplement·SelfOrchestrate·RunDevHarness·
//    SolveMission·run_tests·GitCommit·MergePullRequest)을 프롬프트에 싣는다.
//    ⇒ 코드 *명사*가 아니라 실행 *동사*를 요구한다.
//
// ⭐ 설계 근거(레퍼런스 실측 · ~/source/ref):
//    claude-code-fork 의 ToolSearch 도 `\bterm\b` **키워드 매칭**이다(임베딩·분류기 없음).
//    다만 **검색어를 LLM 이 만든다** — regex 는 *조회* 슬롯에 있다. 반면 이 웜-preload 는
//    사용자 원문을 regex 가 직접 읽어 *의도*를 판정하므로 태생적으로 빗나갈 수 있다.
//    그래서 이건 **최적화(왕복 0)** 로만 취급하고, 빗나감은 정상 — 소환 경로가 폴백이다.
//    (Phase 2 = skill router 와 동형인 LLM 분류기 폴백 · 별건)

import { describe, expect, test } from 'bun:test';
import { nativeToolCatalog } from '../src/native-tool-catalog.js';
import { collectSignals } from '../src/tool-hints/signals.js';

const coding = (text: string): boolean => collectSignals({ recentUserText: text }).intentCoding;

function deferredCodingTool() {
  const candidate = nativeToolCatalog.find(
    (entry) => entry.intentScope === 'coding' && entry.alwaysLoad === false,
  );
  if (!candidate) throw new Error('Expected a deferred coding tool in nativeToolCatalog');
  return candidate;
}

describe('intentCoding — 실행/변경 의도 (대표 실제 문장)', () => {
  // ⭐ 이 트랙을 시작한 그 문장. 종전엔 안 걸려 warmPreloaded:0 이었다.
  test('★M1 원문 — "해결해주세요" 가 실행 의도로 잡힌다', () => {
    expect(coding('과기 히스토리 중에 M1 문제 이제 해결해주세요.  한글 입력문제로')).toBe(true);
  });

  test('★대표가 제시한 자연스러운 표현 — "PTY 나 쉘로 직접 재현하여 분석"', () => {
    expect(coding('PTY or 쉘로 직접 재현하여 내용 분석을 해주세요.')).toBe(true);
  });

  test('한글 실행 동사들', () => {
    for (const t of [
      '이 기능 구현해줘',
      '코드를 수정해줘',
      '버그 재현해봐',
      '이거 고쳐줘',
      '근본 수리해주세요',
      '자율로 만들어줘',
      '셀프 빌드로 돌려줘',
      '워크트리 떠서 작업해',
      '테스트 돌려줘',
      'PR 올려줘',
      '머지해줘',
      '구현했다',
      '수정했어',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: true });
  });

  test('영문 실행 동사들', () => {
    for (const t of [
      'implement this feature',
      'reproduce the bug first',
      'fix the focus loss',
      'patch the bug',
      'fix renderer bugs',
      'merge this PR',
      'run the tests',
      'open a PR when done',
      'use a worktree for this',
      'self-implement it',
      'dogfood this change',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: true });
  });
});

describe('intentCoding — 조사·설계 대화는 걸리지 않는다 (폭주 방지)', () => {
  test('★설명/조사 요청은 배틀쉽을 끌어오지 않는다', () => {
    for (const t of [
      '이 구조 설명해줘',
      '구현 방식 설명해줘',
      '재현 절차 조사해줘',
      '워크트리가 뭐야?',
      'what is a worktree?',
      '수리 방법 설명해줘',
      'what does repro mean?',
      '포커스 매니저가 뭔지 알려줘',
      '로그 좀 봐줘',
      '이 코드 왜 이렇게 됐는지 분석해줘',
      '어떤 파일에 있는지 찾아줘',
      '지금 뭐 돌고 있어?',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: false });
  });

  test('★코드 명사만으로는 안 걸린다 — 동사가 있어야 한다', () => {
    for (const t of [
      '리팩토링 얘기 좀 하자',
      '그 함수 이름이 뭐였지',
      '버그가 있는 것 같아',
      'this is a bug in the renderer',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: false });
  });

  test('★어미에 직접 붙은 의문은 실행 의도가 아니다 — 어간 상태를 묻는 문장', () => {
    // `했(?:다|어|…)?` 의 선택적 그룹이 `했` 단독을, `해(?:줘|…)?` 가 `해` 단독을 허용해
    // 아래 문장들이 걸렸다. 시키는 문장이 아니라 **묻는** 문장이다.
    for (const t of [
      '수정했나요?',
      '구현했나요?',
      '재현했나요?',
      '수리했나요?',
      '이 기능을 수정해야 할까요?',
      // 3차 리뷰가 짚은 `을까요` 누락 + 그걸 일반화해 재보니 같이 새던 것들.
      // 형태소를 하나씩 좇으면 계속 새므로 종결 어미군으로 잡았고, 여기에 그 군을 고정한다.
      '수정했을까요?',
      '구현했을까요?',
      '수정해도 될까요?',
      '수정했습니까?',
      '수정했던가?',
      '수정했나?',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: false });
  });

  test('★의문형 차단은 어간+어미 분기만이 아니라 전 분기에 걸린다', () => {
    // 4차 리뷰: 취소를 한 분기에만 걸었더니 `해결해`·`테스트 실행`·`머지해`·`고쳐`·`만들어`
    // 분기가 통째로 샜다. 어간군 전체를 묶고 뒤에 한 번 거는 구조로 바꿨고, 여기서 잠근다.
    for (const t of [
      '이 문제를 해결해야 할까요?',
      '테스트 실행했나요?',
      '테스트를 돌려야 할까요?',
      '머지해도 될까요?',
      '고쳐야 할까요?',
      '만들어야 할까요?',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: false });
  });

  test('★백트래킹으로 의문 차단이 우회되지 않는다 — 어미를 되뱉어도 막힌다', () => {
    // 5차 리뷰: 부정선읽기 방식은 "수정해**요**?" 를 못 막았다. `수정해요` 로 매치했다가
    // 선읽기에 막히면 정규식이 `요` 를 **되뱉고** `수정해` 로 다시 매치해 통과했기 때문이다.
    // 선읽기는 "이 경로"만 막을 뿐 대안 경로를 못 막는다 ⇒ 꼬리 판정을 정규식 밖으로 뺐다.
    for (const t of [
      '어떻게 수정해요?',
      '어떻게 구현해요?',
      '셀프 빌드가 뭐예요?',   // 명사형 질문 — 동사군은 걸리지만 꼬리가 의문이다
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: false });
  });

  test('★명사화 질문은 실행이 아니다 — "…하는 방법이 뭐예요?"', () => {
    // 6차 리뷰: 동사군은 걸리지만 *방법·절차·이유를 묻는* 문장이다.
    for (const t of [
      '테스트를 실행하는 방법이 뭐예요?',
      '구현하는 방법이 뭐야?',
      '재현하는 절차가 뭐죠?',
      '수정하는 이유가 뭔가요?',
      '테스트 실행하는 방법 알려줘',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: false });
  });

  test('매치가 여럿이면 하나라도 실행형이면 실행 의도다', () => {
    // 꼬리 판정을 매치 단위로 하므로, 뒤에 의문 매치가 붙어도 앞의 실행 매치가 살아남는다.
    expect(coding('수정해줘 그리고 재현했나요?')).toBe(true);
    // 명사화 취소도 마찬가지 — 같은 문장에 진짜 실행 매치(`고쳐`)가 있으면 그쪽이 이긴다.
    expect(coding('수정하는 방법대로 고쳐줘')).toBe(true);
  });

  test('반복 호출에도 답이 흔들리지 않는다 (멱등)', () => {
    // 동사군 정규식이 `/g` 라 상태 누수를 의심해 이걸 넣었는데, 실측하니 `matchAll` 이 정규식을
    // **복제**해 돌아서 지금 구조에서는 애초에 누수가 없다(`lastIndex = 0` 을 지워도 이 테스트가
    // 안 깨진다 — 뮤테이션으로 확인). 즉 이건 그 초기화를 잠그는 테스트가 **아니다.**
    // 그래도 남긴다: 함수의 멱등 계약 자체는 유효하고, 나중에 구현이 `.exec()` 류로 바뀌면
    // 그때 이 테스트가 실제로 값을 한다.
    for (let i = 0; i < 3; i++) expect(coding('테스트 돌려줘')).toBe(true);
    for (let i = 0; i < 3; i++) expect(coding('수정했나요?')).toBe(false);
  });

  test('★전 분기 실행형은 계속 잡힌다 — 취소가 실행까지 먹지 않는다', () => {
    // 위 취소의 짝. 음성만 늘리면 조용히 전부 false 가 돼도 통과하므로 양성을 같이 고정한다.
    for (const t of [
      '이 문제 해결해줘',
      '하나 만들어줘',
      '이거 고쳐줘',
      '자율로 돌려',
      '셀프 빌드 해줘',
      '워크트리 떠서 작업해',
      '워크트리를 떠줘',      // ⚠️ 목적격 조사 — 4차 리뷰가 짚은 누락
      '테스트를 돌려줘',      // ⚠️ 같은 이유
      '테스트를 실행해줘',
      '머지해줘',
      'PR 올려줘',
      'PR을 열어줘',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: true });
  });

  test('⚠️ 취소는 어미에 직접 붙은 의문만 — 뒤에 딸린 별개 의문절은 죽이지 않는다', () => {
    // 바로 위 취소를 "문장 어디든 `?` 가 있으면 배제" 로 만들면 **명시적 실행 요청**까지 죽는다.
    // 실제로 2라운드 자율 수리가 그 함정에 빠져 수렴에 실패했다(`[\s,가-힣]*\?` 가 후보 뒤
    // 한글 구간을 통째로 삼켰다). 그래서 취소 범위를 어미 직후로 못 박고 여기서 잠근다.
    for (const t of [
      '수정해줘 그리고 결과를 알려줄래?',
      '구현해줘. 다 되면 알려줄까?',
    ]) expect({ t, hit: coding(t) }).toEqual({ t, hit: true });
  });

  test('빈 입력에 던지지 않는다', () => {
    expect(collectSignals({}).intentCoding).toBe(false);
    expect(coding('')).toBe(false);
  });
});

describe('배선 — 신호가 coding 스코프를 열어 배틀쉽을 승격한다', () => {
  test('★intentCoding 이 켜지면 warmPreloadScopes 에 coding 이 들어간다', async () => {
    const mod = await import('../src/session-runtime/tier-flip.js');
    // 내부 헬퍼가 export 되지 않으면 applyDeferredTools 경유로 관찰한다.
    const deferredTool = deferredCodingTool();
    const specs = [
      { name: deferredTool.id, description: 'x', parameters: { type: 'object' as const, properties: {} } },
      { name: 'Read', description: 'y', parameters: { type: 'object' as const, properties: {} } },
    ];
    const withIntent = mod.applyDeferredTools(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: '이 버그 재현해서 고쳐줘' }],
      specs as never,
      { enabled: true, userText: '이 버그 재현해서 고쳐줘' },
    );
    const withoutIntent = mod.applyDeferredTools(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: '이 구조 설명해줘' }],
      specs as never,
      { enabled: true, userText: '이 구조 설명해줘' },
    );
    // ★실행 의도면 승격(warmPreloaded 비지 않음) · 조사면 deferred 유지
    // stats.warmPreloaded 는 **개수**(number) — 이름 배열은 TierSplitResult 쪽이다.
    expect(withIntent.stats.warmPreloaded).toBeGreaterThan(0);
    expect(withIntent.stats.deferredNames).not.toContain(deferredTool.displayName);
    expect(withoutIntent.stats.warmPreloaded).toBe(0);
    expect(withoutIntent.stats.deferredNames).toContain(deferredTool.displayName);
  });
});
