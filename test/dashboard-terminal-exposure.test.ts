import { describe, expect, test } from 'bun:test';

import {
  classifyBackgroundTerminalExposure,
  classifyModalTerminalExposure,
  classifyTerminalSessionExposure,
  classifyVwTerminalExposure,
  resolveTerminalInteractionPolicy,
} from '../src/dashboard/terminal-exposure.js';

describe('terminal exposure classifier', () => {
  test('foreground session is user-interactive and agent-interactive', () => {
    expect(classifyTerminalSessionExposure('foreground')).toEqual({
      userExposure: 'user-interactive',
      agentInteractive: true,
    });
  });

  test('background session is hidden to user but still agent-interactive', () => {
    expect(classifyTerminalSessionExposure('background')).toEqual({
      userExposure: 'hidden',
      agentInteractive: true,
    });
  });

  test('exited session is unavailable to both user and agent', () => {
    expect(classifyTerminalSessionExposure('exited')).toEqual({
      userExposure: 'unavailable',
      agentInteractive: false,
    });
  });

  test('vw output-only is observe-only to user but agent-interactive', () => {
    expect(classifyVwTerminalExposure('output-only', 'running')).toEqual({
      userExposure: 'observe-only',
      agentInteractive: true,
    });
  });

  test('modal running is user-interactive and agent-interactive', () => {
    expect(classifyModalTerminalExposure('running')).toEqual({
      userExposure: 'user-interactive',
      agentInteractive: true,
    });
  });

  test('background runner is hidden to user but agent-interactive', () => {
    expect(classifyBackgroundTerminalExposure('running')).toEqual({
      userExposure: 'hidden',
      agentInteractive: true,
    });
  });

  test('interaction policy maps user-interactive to full keyboard and mouse participation', () => {
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

  test('interaction policy maps observe-only to interrupt-only keyboard and discrete mouse transport', () => {
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

  test('interaction policy maps hidden to inspectable but non-user-interactive posture', () => {
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

  test('interaction policy maps unavailable to fully non-interactive posture', () => {
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
