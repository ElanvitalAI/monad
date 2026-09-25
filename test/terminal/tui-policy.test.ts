import { describe, expect, test } from 'bun:test';

import { deriveTerminalCapability } from '../../src/terminal/posture.js';
import {
  describeTerminalPosture,
  deriveTuiInteractionPolicy,
  resolveTerminalInteractionPolicy,
} from '../../src/terminal/tui-policy.js';

describe('TUI interaction policy (Layer 2)', () => {
  describe('resolveTerminalInteractionPolicy parity', () => {
    // PR #1333 이 lock-in 한 4×5 매트릭스 — 새 deriveTuiInteractionPolicy 가
    // 동일 결과 반환해야 G6 (capability is gate · intent 의미 흡수 금지) 와
    // 회귀 0 둘 다 만족.
    test('user-interactive matches frozen matrix', () => {
      expect(resolveTerminalInteractionPolicy({
        userExposure: 'user-interactive',
        agentInteractive: true,
      })).toEqual({
        keyboardParticipation: 'full',
        mouseTransport: 'full',
        hostMouseIntentVisible: true,
        hostInspectable: true,
        agentWriteAllowed: true,
      });
    });

    test('observe-only matches frozen matrix', () => {
      expect(resolveTerminalInteractionPolicy({
        userExposure: 'observe-only',
        agentInteractive: true,
      })).toEqual({
        keyboardParticipation: 'interrupt-only',
        mouseTransport: 'discrete-only',
        hostMouseIntentVisible: true,
        hostInspectable: true,
        agentWriteAllowed: true,
      });
    });

    test('hidden matches frozen matrix', () => {
      expect(resolveTerminalInteractionPolicy({
        userExposure: 'hidden',
        agentInteractive: true,
      })).toEqual({
        keyboardParticipation: 'none',
        mouseTransport: 'none',
        hostMouseIntentVisible: false,
        hostInspectable: true,
        agentWriteAllowed: true,
      });
    });

    test('unavailable matches frozen matrix', () => {
      expect(resolveTerminalInteractionPolicy({
        userExposure: 'unavailable',
        agentInteractive: false,
      })).toEqual({
        keyboardParticipation: 'none',
        mouseTransport: 'none',
        hostMouseIntentVisible: false,
        hostInspectable: false,
        agentWriteAllowed: false,
      });
    });
  });

  describe('deriveTuiInteractionPolicy with capability', () => {
    test('produces identical result when capability matches exposure', () => {
      // Capability 는 derive 의 input. exposure 와 일치하는 capability 를
      // 입력하면 legacy resolve 와 같은 결과.
      const exposure = {
        userExposure: 'observe-only' as const,
        agentInteractive: true,
      };
      const capability = deriveTerminalCapability(exposure);
      expect(deriveTuiInteractionPolicy(capability, exposure))
        .toEqual(resolveTerminalInteractionPolicy(exposure));
    });

    test('respects capability.canInterrupt for observe-only keyboard', () => {
      // G6 invariant — capability vector 가 입력으로 들어가면 영향을 미친다.
      // 가설: 미래에 capability.canInterrupt 가 false 인 observe-only 가
      // 도입되면 keyboardParticipation 도 'none' 으로 떨어져야.
      const exposure = {
        userExposure: 'observe-only' as const,
        agentInteractive: true,
      };
      const capabilityNoInterrupt = {
        canRead: true,
        canInterrupt: false,
        canWrite: false,
        canInspect: true,
      };
      const policy = deriveTuiInteractionPolicy(capabilityNoInterrupt, exposure);
      expect(policy.keyboardParticipation).toBe('none');
    });
  });

  describe('describeTerminalPosture', () => {
    test('composes exposure + interaction policy', () => {
      const exposure = {
        userExposure: 'user-interactive' as const,
        agentInteractive: true,
      };
      expect(describeTerminalPosture(exposure)).toEqual({
        exposure,
        interactionPolicy: resolveTerminalInteractionPolicy(exposure),
      });
    });
  });
});
