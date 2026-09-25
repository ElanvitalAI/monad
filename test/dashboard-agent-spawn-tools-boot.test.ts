import { describe, expect, test } from 'bun:test';

import { bootDashboardAgentSpawnTools } from '../src/dashboard/agent-spawn-tools-boot.js';

describe('bootDashboardAgentSpawnTools', () => {
  test('wires both coding and embodied spawn tools to the VW registry', () => {
    const events: string[] = [];
    const registry = { id: 'vw-registry-test' } as unknown as import('../src/virtual-windows/window-registry.js').WindowRegistry;

    bootDashboardAgentSpawnTools({
      registry,
      initSpawnCodingAgentInVW: (value) => {
        expect(value).toBe(registry);
        events.push('coding');
      },
      initSpawnEmbodiedAgentInVW: (value) => {
        expect(value).toBe(registry);
        events.push('embodied');
      },
    });

    expect(events).toEqual(['coding', 'embodied']);
  });
});
