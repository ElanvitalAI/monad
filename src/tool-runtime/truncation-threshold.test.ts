// ── U-1b ⊕ 대표 *"어떤 것이 파일로 빠지게 하는지"* — **영속 임계를 직접 부른다** (2026-08-02) ──
//
// ⛔ 라이브 실험은 실패했다: 두 노브(`chat.toolOutput.previewLines` vs
//    `chat.rendering.tool.blockMaxLines`)를 갈라 격리 TUI 로 재려 했으나, **모델이 스스로**
//    읽기를 세 구간으로 쪼개 각 호출이 임계 아래로 내려갔다(*"probe60.txt의 세 구간을 직접 읽어"*).
//    ⇒ 표본 크기를 모델이 정하므로 라이브로는 임계를 못 친다.
// ⇒ ⭐ 그래서 **`persistToolOutputPreview` 를 직접 부른다.** 순수 함수라 임계가 결정론적이다.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistToolOutputPreview } from './truncation-store.js';

const cfg = (previewLines: number, persistOnOverflow = true) =>
  ({ persistOnOverflow, previewLines, retentionDays: 7 });

/** ⭐ 임시 디렉토리를 **여기서** 만들고 **여기서** 지운다 — 호출자에게 맡기면 실패 경로에서
 *  누수된다(무인 리뷰 should-fix). 검사는 콜백 안에서 하고, 정리는 성공·실패 모두 보장한다. */
const withRun = async (
  lines: number,
  previewLines: number,
  check: (r: Awaited<ReturnType<typeof persistToolOutputPreview>>, baseDir: string) => void,
  persistOnOverflow = true,
): Promise<void> => {
  const baseDir = mkdtempSync(join(tmpdir(), 'u1b-persist-'));
  try {
    const text = Array.from({ length: lines }, (_, i) => `line-${i + 1}`).join('\n');
    const r = await persistToolOutputPreview(text, {
      config: cfg(previewLines, persistOnOverflow),
      sessionId: 's', toolName: 'Read', baseDir, nowMs: 1_700_000_000_000,
    } as never);
    check(r, baseDir);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
};

describe('U-1b — 영속 임계는 **줄 수**다 (문자 수가 아니다)', () => {
  test('임계 이하면 그대로 통과한다 (파일을 안 만든다)', async () => {
    await withRun(5, 5, (r, baseDir) => {
      expect(r.persisted).toBe(false);
      expect(r.totalLines).toBe(5);
      expect(r.output.split('\n')).toHaveLength(5);
      expect(existsSync(join(baseDir, 's'))).toBe(false);
    });
  });

  test('⭐ 임계를 한 줄만 넘어도 파일로 빠진다 — 경계가 previewLines 다', async () => {
    await withRun(6, 5, (r) => {
      expect(r.persisted).toBe(true);
      expect(r.path).toBeTruthy();
      expect(existsSync(r.path!)).toBe(true);
      // 화면에 남는 것 = 앞 previewLines 줄 + 참조 한 줄
      expect(r.output.split('\n')).toHaveLength(6);
      expect(r.output).toContain('Full output saved to');
    });
  });

  test('⭐⭐ previewLines 를 바꾸면 화면에 남는 줄 수가 그만큼 바뀐다', async () => {
    for (const preview of [3, 8, 20]) {
      await withRun(100, preview, (r) => {
        expect(r.persisted).toBe(true);
        expect(r.output.split('\n')).toHaveLength(preview + 1);   // 앞 preview 줄 + 참조 1줄
      });
    }
  });

  test('persistOnOverflow=false 면 임계를 넘겨도 안 빠진다 (끄는 스위치)', async () => {
    await withRun(100, 5, (r) => {
      expect(r.persisted).toBe(false);
      expect(r.output.split('\n')).toHaveLength(100);
    }, false);
  });

});
