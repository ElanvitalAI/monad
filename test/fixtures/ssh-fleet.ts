// 시험용 ssh fleet — 자리표 이름만 쓴다(실제 호스트 0).
// 코드 기본 fleet 은 비어 있으므로(src/ssh/ssh-hosts.ts) fleet 이 필요한 시험은
// beforeEach 에서 `setSshHostsForTesting(TEST_FLEET)` 로 이것을 주입한다.
import type { SshHost } from '../../src/ssh/ssh-hosts.js';

export const TEST_FLEET: readonly SshHost[] = Object.freeze([
  { name: 'mba',    host: 'mba',    description: 'MacBook Air' },
  { name: 'node-b', host: 'node-b', description: 'Mac Studio B1', roles: ['llm', 'media'] },
  { name: 'mbp',    host: 'mbp',    description: 'MacBook Pro' },
  { name: 'minio',  host: 'minio',  description: 'Mac mini (storage)' },
  { name: 'node-c', host: 'node-c', description: 'Mac mini (home)' },
]);
