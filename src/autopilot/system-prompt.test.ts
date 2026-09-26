// src/autopilot/system-prompt.test.ts
//
// MB-12 — mission classifier + system prompt composition unit tests.

import { describe, test, expect } from 'bun:test';
import {
  classifyMission,
  composeAutopilotSystemPrompt,
} from './system-prompt.js';

describe('classifyMission', () => {
  test('empty / whitespace → general', () => {
    expect(classifyMission('').kind).toBe('general');
  });

  test('terminal keyword (tmux/vim/nvim) → terminal', () => {
    expect(classifyMission('use tmux to split the screen').kind).toBe('terminal');
    expect(classifyMission('open vim and edit').kind).toBe('terminal');
    expect(classifyMission('nvim 으로 src/foo.ts 편집').kind).toBe('terminal');
  });

  test('Korean 터미널 → terminal', () => {
    expect(classifyMission('터미널에서 작업 진행').kind).toBe('terminal');
  });

  test('git keyword → git', () => {
    expect(classifyMission('git commit -am "fix"').kind).toBe('git');
    expect(classifyMission('Open PR for this branch').kind).toBe('git');
    expect(classifyMission('이거 커밋해줘').kind).toBe('git');
  });

  test('research keyword → research', () => {
    expect(classifyMission('Search the web for LLM benchmarks').kind).toBe('research');
    expect(classifyMission('find best practice for SwiftUI').kind).toBe('research');
    expect(classifyMission('이거 찾아줘').kind).toBe('research');
  });

  test('file path → code', () => {
    expect(classifyMission('refactor src/foo.ts').kind).toBe('code');
    expect(classifyMission('fix the bug in ContentView.swift').kind).toBe('code');
  });

  test('implement keyword → code', () => {
    expect(classifyMission('implement the new feature').kind).toBe('code');
    expect(classifyMission('이 기능 구현해줘').kind).toBe('code');
  });

  test('unmatched → general', () => {
    expect(classifyMission('say hello').kind).toBe('general');
    expect(classifyMission('what is the current weather').kind).toBe('general');
  });

  test('terminal priority > git when both present', () => {
    // user mentions tmux + commit — terminal wins (more specific surface)
    expect(classifyMission('use tmux split then git commit').kind).toBe('terminal');
  });

  // MB-15 — expanded Korean keyword coverage
  test('한글 terminal 확장: 콘솔/명령어', () => {
    expect(classifyMission('콘솔에서 npm test 실행').kind).toBe('terminal');
    expect(classifyMission('이 명령어 실행해줘').kind).toBe('terminal');
  });

  test('한글 git 확장: 푸시/머지/브랜치/스쿼시', () => {
    expect(classifyMission('이 브랜치 푸시해줘').kind).toBe('git');
    expect(classifyMission('main 으로 머지').kind).toBe('git');
    expect(classifyMission('feature 브랜치 만들어').kind).toBe('git');
    expect(classifyMission('이거 스쿼시 머지').kind).toBe('git');
  });

  test('한글 research 확장: 알아봐/알려줘/문서/트렌드/비교', () => {
    expect(classifyMission('이 API 알아봐').kind).toBe('research');
    expect(classifyMission('Vue 와 React 비교 알려줘').kind).toBe('research');
    expect(classifyMission('SwiftUI 문서 읽고').kind).toBe('research');
    expect(classifyMission('최신 LLM 트렌드').kind).toBe('research');
  });

  test('한글 code 확장: 함수/메서드/에러/고쳐/만들어/작성', () => {
    expect(classifyMission('이 함수 리팩토링').kind).toBe('code');
    expect(classifyMission('에러 고쳐줘').kind).toBe('code');
    expect(classifyMission('새 메서드 만들어').kind).toBe('code');
    expect(classifyMission('Helper 작성').kind).toBe('code');
  });
});

describe('composeAutopilotSystemPrompt', () => {
  test('contains core principles paragraph', () => {
    const p = composeAutopilotSystemPrompt('hi');
    expect(p).toContain('elanous-builtin autopilot');
    expect(p).toContain('One tool call per turn');
  });

  test('git mission contains git guidance', () => {
    const p = composeAutopilotSystemPrompt('git commit and push');
    expect(p).toContain('GIT');
    expect(p).toContain('git_commit');
  });

  test('research mission contains web tool guidance', () => {
    const p = composeAutopilotSystemPrompt('search web for LLM trends');
    expect(p).toContain('RESEARCH');
    expect(p).toContain('WebSearch');
    expect(p).toContain('WebFetch');
  });

  test('code mission contains Read-before-Edit guidance', () => {
    const p = composeAutopilotSystemPrompt('refactor src/foo.ts');
    expect(p).toContain('CODE');
    expect(p).toContain('Read before Edit');
  });

  test('terminal mission contains screenshot observation note', () => {
    const p = composeAutopilotSystemPrompt('use tmux to split');
    expect(p).toContain('TERMINAL');
    expect(p).toContain('screenshot');
  });

  test('terminalAgency=true appends terminal agency reminder', () => {
    const p = composeAutopilotSystemPrompt('hi', { terminalAgency: true });
    expect(p).toContain('Terminal agency note');
    expect(p).toContain('rm -rf');
  });

  test('terminalAgency=false omits reminder', () => {
    const p = composeAutopilotSystemPrompt('hi', { terminalAgency: false });
    expect(p).not.toContain('Terminal agency note');
  });

  test('explicit missionType override is honored', () => {
    const p = composeAutopilotSystemPrompt('totally vague mission text', {
      missionType: { kind: 'git' },
    });
    expect(p).toContain('GIT');
  });

  test('general mission picks general guidance', () => {
    const p = composeAutopilotSystemPrompt('say hello');
    expect(p).toContain('GENERAL');
    expect(p).toContain('AskUserQuestion');
  });
});
