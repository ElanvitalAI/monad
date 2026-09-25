// RelayShellPrompt 툴 어댑터 — ctx→SurfaceUx 변환·autoDrive off 강제·주입 검증.
import { test, expect, describe } from 'bun:test';
import { buildRelayShellPromptTool, dispatchRelayShellPrompt } from './relay-shell.js';
import type { DaemonToolDispatchCtx } from '../../boot/daemon-tools/types.js';
import type { ConfirmChannel } from '../../hitl/confirm.js';
import type { ShellInjector } from '../../harness/shell-relay.js';

/** 주입 캡처 seam(실 registry 무접촉). */
function captureInject() {
  const sent: string[] = [];
  const inject: ShellInjector = async ({ bytes }) => { sent.push(bytes); return { ok: true, output: 'ack-delta' }; };
  return { inject, sent };
}

/** 승인/거절 confirm 채널. */
function confirmChannel(answer: boolean): ConfirmChannel {
  return { name: 'telegram', async request() { return answer; }, cancel() {} };
}

describe('buildRelayShellPromptTool — 스펙', () => {
  test('name·required 필드', () => {
    const spec = buildRelayShellPromptTool();
    expect(spec.name).toBe('RelayShellPrompt');
    expect(spec.parameters.required).toEqual(['process_id', 'prompt']);
  });
});

describe('dispatchRelayShellPrompt — 라운드트립', () => {
  test('confirm 승인 → y 주입(ctx 채널 경유)', async () => {
    const { inject, sent } = captureInject();
    const ctx = { surfaceHitlChannels: [confirmChannel(true)] } as unknown as DaemonToolDispatchCtx;
    const res = await dispatchRelayShellPrompt({ process_id: 'relay-1', prompt: 'Apply patch? (y/n)' }, ctx, { inject });
    expect(sent).toEqual(['y\n']);
    expect(res.output).toContain('injected');
    expect(res.output).toContain('interactive=true');
    expect(res.output).toContain('ack-delta');
  });

  test('채널 없는 ctx → fail-closed decline(n) 주입', async () => {
    const { inject, sent } = captureInject();
    const res = await dispatchRelayShellPrompt({ process_id: 'relay-2', prompt: 'Apply? (y/n)' }, {} as DaemonToolDispatchCtx, { inject });
    expect(sent).toEqual(['n\n']);
    expect(res.output).toContain('interactive=false');
  });

  test('options → 메뉴 라벨 주입(question 채널 없으면 보류)', async () => {
    const { inject, sent } = captureInject();
    // 채널 없음 → question null → 비대화형 메뉴 fail-closed(주입 안 함).
    const res = await dispatchRelayShellPrompt(
      { process_id: 'relay-3', prompt: 'File exists', options: ['Overwrite', 'Skip'] },
      {} as DaemonToolDispatchCtx, { inject },
    );
    expect(sent).toEqual([]);
    expect(res.output).toContain('did NOT inject');
  });

  test('§6(b) 자동감지: options 없이 번호메뉴 프롬프트 → 감지·방향키 주입', async () => {
    const { inject, sent } = captureInject();
    const ctx = {
      surfaceQuestionChannels: [{
        name: 'telegram',
        async ask() { return { answers: { shell_relay: 'Skip' } }; },
        cancel() {},
      }],
    } as unknown as DaemonToolDispatchCtx;
    const prompt = '1) Overwrite\n2) Skip\n3) Rename\nChoose:';
    const res = await dispatchRelayShellPrompt({ process_id: 'relay-9', prompt }, ctx, { inject });
    // 감지된 번호메뉴 → optionStyle arrows → Skip(index 1) = ↓×1 + Enter.
    expect(sent).toEqual(['\x1b[B\r']);
    expect(res.output).toContain('injected');
  });

  test('process_id/prompt 누락 → 명확한 에러', async () => {
    await expect(dispatchRelayShellPrompt({ prompt: 'x' })).rejects.toThrow('process_id required');
    await expect(dispatchRelayShellPrompt({ process_id: 'x' })).rejects.toThrow('prompt required');
  });
});
