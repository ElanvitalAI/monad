// ── listToolRuntimes('mcp') 의 proxy fallback 검증 (Phase 3) ──
//
// RFC #2474 §5.5 의 MCP server relay (Claude Code → monad MCP server
// → external MCP server) 가 작동하려면 `listToolRuntimes('mcp')` 가
// proxy runtime 들을 응답에 포함해야 한다. proxy 는 native_tool_catalog
// 에 entry 가 없으므로 catalog 필터만으로는 빠짐. Phase 3 에서 추가한
// `runtime.surfaces` fallback 이 그 gap 을 메운다.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  registerToolRuntime,
  listToolRuntimes,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/registry';
import type { ToolRuntime } from '../src/tool-runtime/types';

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
});

function makeRuntime(id: string, surfaces?: Array<'skill' | 'tui' | 'mcp'>): ToolRuntime {
  return {
    id,
    spec: { name: id, description: '', parameters: {} },
    ...(surfaces ? { surfaces } : {}),
    async run() {
      return { output: 'noop' };
    },
  };
}

describe("listToolRuntimes('mcp') fallback for catalog-less runtimes", () => {
  test('proxy runtime with surfaces:["mcp"] IS included', () => {
    const proxy = makeRuntime('xcode.build_target', ['mcp']);
    registerToolRuntime(proxy);
    const tools = listToolRuntimes('mcp');
    expect(tools.length).toBe(1);
    expect(tools[0]!.id).toBe('xcode.build_target');
  });

  test('proxy runtime with surfaces:["tui"] is NOT included for "mcp" filter', () => {
    const proxy = makeRuntime('foo.bar', ['tui']);
    registerToolRuntime(proxy);
    expect(listToolRuntimes('mcp').length).toBe(0);
    expect(listToolRuntimes('tui').length).toBe(1);
  });

  test('catalog-less runtime with NO surfaces is excluded from every filter', () => {
    registerToolRuntime(makeRuntime('mystery.thing'));
    expect(listToolRuntimes('mcp').length).toBe(0);
    expect(listToolRuntimes('skill').length).toBe(0);
    expect(listToolRuntimes('tui').length).toBe(0);
  });

  test('listToolRuntimes() with no surface returns all (catalog-less included)', () => {
    registerToolRuntime(makeRuntime('xcode.build', ['mcp']));
    registerToolRuntime(makeRuntime('xcodebuild.run_tests', ['mcp']));
    registerToolRuntime(makeRuntime('mystery.thing'));
    expect(listToolRuntimes().length).toBe(3);
  });

  test('multiple proxy runtimes from the same MCP server surface together', () => {
    registerToolRuntime(makeRuntime('xcode.build_target', ['mcp']));
    registerToolRuntime(makeRuntime('xcode.run_tests', ['mcp']));
    registerToolRuntime(makeRuntime('xcode.screenshot', ['mcp']));
    const ids = listToolRuntimes('mcp').map((r) => r.id);
    expect(ids.length).toBe(3);
    expect(ids).toContain('xcode.build_target');
    expect(ids).toContain('xcode.screenshot');
  });

  test('proxy + native catalog tools coexist in the relay response', () => {
    // Real native tool whose catalog entry already declares 'mcp' surface
    // (capture_screenshot is in nativeToolCatalog with ['skill','dashboard','mcp']).
    registerToolRuntime(makeRuntime('capture_screenshot'));
    // Proxy tool (no catalog entry, surfaces field carries the relay flag).
    registerToolRuntime(makeRuntime('xcode.build', ['mcp']));
    const ids = listToolRuntimes('mcp').map((r) => r.id);
    expect(ids).toContain('capture_screenshot'); // native via catalog
    expect(ids).toContain('xcode.build'); // proxy via runtime.surfaces
  });
});
