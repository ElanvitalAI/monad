// Type-level contract for parsed MCP server specs.
// Consumed by `tsc --noEmit -p test/tsconfig.mcp-spec.json` (see
// test/user-config-mcp.test.ts). bun test does not type-check these
// expect-error directives; the dedicated tsc gate does.
import type { McpHttpServerSpec, McpServerSpec, McpStdioServerSpec } from '../src/user-config';

const _validStdio: McpStdioServerSpec = {
  id: 'x',
  transport: 'stdio',
  command: ['x'],
};
const _validHttp: McpHttpServerSpec = {
  id: 'x',
  transport: 'http',
  url: 'https://mcp.example.com',
  oauthIssuer: 'https://issuer.example.com',
  oauthTokenEndpoint: 'https://issuer.example.com/token',
};
const _validStdioAsUnion: McpServerSpec = _validStdio;
const _validHttpAsUnion: McpServerSpec = _validHttp;

// @ts-expect-error — { id } is not a valid parsed server
const _idOnly = { id: 'x' } satisfies McpServerSpec;
// @ts-expect-error — stdio requires command
const _stdioNoCommand = { id: 'x', transport: 'stdio' } satisfies McpServerSpec;
// @ts-expect-error — http requires url
const _httpNoUrl = { id: 'x', transport: 'http' } satisfies McpServerSpec;
const _stdioWithUrl = {
  id: 'x',
  transport: 'stdio' as const,
  command: ['x'],
  url: 'https://mcp.example.com',
// @ts-expect-error — stdio cannot carry url
} satisfies McpServerSpec;
const _httpWithCommand = {
  id: 'x',
  transport: 'http' as const,
  url: 'https://mcp.example.com',
  command: ['x'],
// @ts-expect-error — http cannot carry command
} satisfies McpServerSpec;
const _stdioWithOAuth = {
  id: 'x',
  transport: 'stdio' as const,
  command: ['x'],
  // @ts-expect-error — stdio cannot carry HTTP OAuth fields
  oauthIssuer: 'https://issuer.example.com',
} satisfies McpServerSpec;

void _validStdioAsUnion;
void _validHttpAsUnion;
void _idOnly;
void _stdioNoCommand;
void _httpNoUrl;
void _stdioWithUrl;
void _httpWithCommand;
void _stdioWithOAuth;
