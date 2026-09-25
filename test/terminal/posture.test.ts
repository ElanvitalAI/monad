import { describe, expect, test } from 'bun:test';

import {
  classifyBackgroundTerminalExposure,
  classifyModalTerminalExposure,
  classifyTerminalSessionExposure,
  classifyVwTerminalExposure,
  deriveTerminalCapability,
  interactiveTerminalExposure,
} from '../../src/terminal/posture.js';

describe('terminal posture (Layer 1)', () => {
  describe('deriveTerminalCapability', () => {
    test('user-interactive grants all four capabilities', () => {
      expect(deriveTerminalCapability({
        userExposure: 'user-interactive',
        agentInteractive: true,
      })).toEqual({
        canRead: true,
        canInterrupt: true,
        canWrite: true,
        canInspect: true,
      });
    });

    test('observe-only grants read + interrupt + inspect but not write', () => {
      expect(deriveTerminalCapability({
        userExposure: 'observe-only',
        agentInteractive: true,
      })).toEqual({
        canRead: true,
        canInterrupt: true,
        canWrite: false,
        canInspect: true,
      });
    });

    test('hidden denies all user-facing capabilities', () => {
      expect(deriveTerminalCapability({
        userExposure: 'hidden',
        agentInteractive: true,
      })).toEqual({
        canRead: false,
        canInterrupt: false,
        canWrite: false,
        canInspect: false,
      });
    });

    test('unavailable denies all capabilities', () => {
      expect(deriveTerminalCapability({
        userExposure: 'unavailable',
        agentInteractive: false,
      })).toEqual({
        canRead: false,
        canInterrupt: false,
        canWrite: false,
        canInspect: false,
      });
    });

    test('agent-only hidden shell still has user capability all-false', () => {
      // hidden + agentInteractive=true 는 bg shell — agent 는 살아있지만
      // user 시점 capability 는 전부 false (capability 는 user 시점만 다룸).
      expect(deriveTerminalCapability({
        userExposure: 'hidden',
        agentInteractive: true,
      })).toEqual({
        canRead: false,
        canInterrupt: false,
        canWrite: false,
        canInspect: false,
      });
    });
  });

  describe('exposure classifiers (host-agnostic)', () => {
    test('vw classifier maps focus + status correctly', () => {
      expect(classifyVwTerminalExposure('interactive', 'running')).toEqual({
        userExposure: 'user-interactive',
        agentInteractive: true,
      });
      expect(classifyVwTerminalExposure('output-only', 'running')).toEqual({
        userExposure: 'observe-only',
        agentInteractive: true,
      });
      expect(classifyVwTerminalExposure('interactive', 'completed')).toEqual({
        userExposure: 'unavailable',
        agentInteractive: false,
      });
      expect(classifyVwTerminalExposure('output-only', 'killed')).toEqual({
        userExposure: 'unavailable',
        agentInteractive: false,
      });
    });

    test('modal classifier never reduces to observe-only', () => {
      expect(classifyModalTerminalExposure('running').userExposure).toBe('user-interactive');
      expect(classifyModalTerminalExposure('completed').userExposure).toBe('unavailable');
    });

    test('background classifier defaults to hidden when alive', () => {
      expect(classifyBackgroundTerminalExposure('running').userExposure).toBe('hidden');
      expect(classifyBackgroundTerminalExposure('backgrounded').userExposure).toBe('hidden');
      expect(classifyBackgroundTerminalExposure('killed').userExposure).toBe('unavailable');
    });

    test('session classifier maps state to exposure', () => {
      expect(classifyTerminalSessionExposure('foreground').userExposure).toBe('user-interactive');
      expect(classifyTerminalSessionExposure('background').userExposure).toBe('hidden');
      expect(classifyTerminalSessionExposure('exited').userExposure).toBe('unavailable');
    });
  });

  describe('interactiveTerminalExposure', () => {
    test('defaults to agent-interactive', () => {
      expect(interactiveTerminalExposure()).toEqual({
        userExposure: 'user-interactive',
        agentInteractive: true,
      });
    });

    test('honors explicit agent-non-interactive', () => {
      expect(interactiveTerminalExposure(false)).toEqual({
        userExposure: 'user-interactive',
        agentInteractive: false,
      });
    });
  });
});
