import { describe, expect, it, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { McpAppBlock, mcpAppServerOf } from './McpAppBlock';
import { MCP_WIRE_DELIMITER, toWireToolName } from '../../../../../../src/tool-runtime/mcp-wire-name';

describe('McpAppBlock', () => {
  it('renders the tool identity, name, screen URL, and fallback text as static text', () => {
    const html = renderToStaticMarkup(
      <McpAppBlock
        block={{
          kind: 'mcp_app',
          toolId: 'tool-42',
          toolName: 'Canvas',
          screenUrl: 'https://apps.example.test/canvas',
          fallbackText: 'Open this canvas in a compatible client.',
        }}
      />,
    );

    expect(html).toContain('tool-42');
    expect(html).toContain('Canvas');
    expect(html).toContain('https://apps.example.test/canvas');
    expect(html).toContain('Open this canvas in a compatible client.');
    expect(html).not.toMatch(/<(iframe|embed|script)\b/);
  });

  it('renders valid app HTML in the isolated frame with propagated origins', () => {
    const html = renderToStaticMarkup(
      <McpAppBlock
        block={{
          kind: 'mcp_app',
          toolId: 'tool-42',
          toolName: 'Canvas',
          screenUrl: 'ui://canvas',
          html: '<main>Canvas app</main>',
          connectDomains: ['https://api.example.test'],
          resourceDomains: ['https://cdn.example.test'],
        }}
      />,
    );

    expect(html).toContain('data-monad-mcp-app-frame="true"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('connect-src https://api.example.test');
    expect(html).toContain('img-src https://cdn.example.test');
    expect(html).not.toContain('connect-src https://cdn.example.test');
  });

  it('omits fallback markup when no fallback text is supplied', () => {
    const html = renderToStaticMarkup(
      <McpAppBlock
        block={{
          kind: 'mcp_app',
          toolId: 'tool-42',
          toolName: 'Canvas',
          screenUrl: 'https://apps.example.test/canvas',
        }}
      />,
    );

    expect(html).toContain('https://apps.example.test/canvas');
    expect(html).not.toMatch(/<p/);
  });
});

/** ⛔ Regression for a defect this file shipped: the server prefix was read
 *  from `toolId`, which is the tool *call* id, not the registry name. The two
 *  fields come from `onToolResult({ id, name })` and only `name` carries
 *  `<server>.<tool>`. */
describe('which field carries the server', () => {
  test('reads the prefix from the registry name', () => {
    expect(mcpAppServerOf('higgsfield.generate_image')).toBe('higgsfield');
  });

  test('a call id has no server to read', () => {
    // Real call ids look like this — splitting one on '.' yields nonsense.
    expect(mcpAppServerOf('call_a1b2c3d4')).toBe('');
  });

  test('an unprefixed local tool has no server', () => {
    expect(mcpAppServerOf('Read')).toBe('');
  });

  test('only the first segment is the server', () => {
    expect(mcpAppServerOf('higgsfield.image.v2')).toBe('higgsfield');
  });
});

describe('the server the frame is actually given', () => {
  const block = {
    kind: 'mcp_app' as const,
    toolId: 'call_a1b2c3d4',
    toolName: 'higgsfield.generate_image',
    screenUrl: 'ui://higgsfield/generation-v2.html',
    html: '<div>w</div>',
  };

  test('comes from the registry name, not the call id', () => {
    const html = renderToStaticMarkup(<McpAppBlock block={block} />);
    expect(html).toContain('data-monad-mcp-server="higgsfield"');
  });

  test('is empty when the tool has no server prefix', () => {
    const html = renderToStaticMarkup(<McpAppBlock block={{ ...block, toolName: 'Read' }} />);
    expect(html).toContain('data-monad-mcp-server=""');
  });
});

/** ⛔ 2026-08-21: 이 함수가 «하루에 두 번» 틀렸다. 두 번 다 위젯이 안 뜨는 원인이었다. */
describe('서버 접두 — 구분자가 «둘»이다', () => {
  test('전선 이름(__)에서 뽑는다 — 프로바이더가 점을 금지해 이 모양이 «기본»이다', () => {
    expect(mcpAppServerOf('higgsfield__generate_image')).toBe('higgsfield');
  });

  test('레지스트리 이름(.)에서도 뽑는다 — 안쪽은 여전히 점을 쓴다', () => {
    expect(mcpAppServerOf('higgsfield.generate_image')).toBe('higgsfield');
  });

  test('🚨 회귀 — 점만 찾으면 전선 이름에서 «빈 문자열»이 나온다(그래서 조회를 건너뛰었다)', () => {
    const dotOnly = (n: string): string => { const i = n.indexOf('.'); return i === -1 ? '' : n.slice(0, i); };
    expect(dotOnly('higgsfield__generate_image')).toBe('');
    expect(mcpAppServerOf('higgsfield__generate_image')).not.toBe('');
  });

  test('접두가 없는 내장 툴은 여전히 빈 문자열', () => {
    expect(mcpAppServerOf('Read')).toBe('');
  });

  test('맨 앞이 구분자면 서버가 아니다', () => {
    expect(mcpAppServerOf('__weird')).toBe('');
    expect(mcpAppServerOf('.weird')).toBe('');
  });

  test('툴 이름 안에 밑줄이 있어도 «서버»만 잘린다', () => {
    expect(mcpAppServerOf('higgsfield__show_generation_by_ids')).toBe('higgsfield');
  });
});

/** ⭐⭐⭐ 두 층을 «잇는» 시험 — 위의 시험들은 전부 문자열을 «베꼈다». 베낀 시험은 한쪽만 문다.
 *
 *  📏 `#10815` 이 그 증거다: 이름을 «만드는 쪽»이 `.` → `__` 로 바뀌었는데 읽는 쪽 시험은
 *  자기가 베낀 `.` 문자열을 계속 통과시켰다. 두 쪽 다 초록이었고 위젯은 안 떴다.
 *
 *  ⇒ ⛔ 그래서 여기서는 이름을 «만드는 쪽에서 만들어» 읽는 쪽에 먹인다.
 *    구분자가 또 바뀌면 이 시험은 «자동으로» 새 구분자를 시험한다 — 고칠 것이 없다. */
describe('전선 이름 계약 — 만드는 쪽과 읽는 쪽이 «같이» 움직인다', () => {
  test('만드는 쪽이 낸 이름에서 읽는 쪽이 서버를 뽑는다', () => {
    expect(mcpAppServerOf(toWireToolName('higgsfield.generate_image'))).toBe('higgsfield');
  });

  test('구분자를 베끼지 않는다 — 읽는 쪽이 쓰는 구분자가 «만드는 쪽»의 것이다', () => {
    expect(toWireToolName('higgsfield.x')).toBe(`higgsfield${MCP_WIRE_DELIMITER}x`);
    expect(mcpAppServerOf(`higgsfield${MCP_WIRE_DELIMITER}x`)).toBe('higgsfield');
  });

  test('점 없는 이름은 만드는 쪽이 그대로 두고, 읽는 쪽도 서버가 없다고 답한다', () => {
    expect(toWireToolName('Read')).toBe('Read');
    expect(mcpAppServerOf(toWireToolName('Read'))).toBe('');
  });
});
