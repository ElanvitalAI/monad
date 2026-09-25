// Autopilot PWA API(Phase B1) 단위테스트 — triage/arming 결정론, repo-watch/autonomy 형태.
import { describe, test, expect } from 'bun:test';
import {
  handleTriagePreview, handleArmingGet, handleRepoWatchGet, handleAutonomyGet,
  parseAutopilotPath,
} from './autopilot-api.js';

function post(body: unknown): Request {
  return new Request('http://x/v1/autopilot/triage-preview', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

describe('parseAutopilotPath', () => {
  test('지원 섹션', () => {
    expect(parseAutopilotPath('/v1/autopilot/repo-watch')).toBe('repo-watch');
    expect(parseAutopilotPath('/v1/autopilot/autonomy')).toBe('autonomy');
    expect(parseAutopilotPath('/v1/autopilot/arming')).toBe('arming');
    expect(parseAutopilotPath('/v1/autopilot/missions')).toBe('missions'); // AL4
    expect(parseAutopilotPath('/v1/autopilot/trace')).toBe('trace');       // AL4
  });
  test('미지원 → null', () => {
    expect(parseAutopilotPath('/v1/autopilot/triage-preview')).toBeNull(); // POST 전용
    expect(parseAutopilotPath('/v1/dashboard/summary')).toBeNull();
  });
});

describe('POST /v1/autopilot/triage-preview', () => {
  test('골 → 실행모델 분류', async () => {
    const res = await handleTriagePreview(post({ goal: '삼성 급락하면 매매 검토' }));
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.ok).toBe(true);
    expect(j.triage.executionModel).toBe('monitor-trigger');
    expect(j.triage.engine).toBe('monitor');
    expect(j.triage.tier).toBeDefined();
  });
  test('goal 없으면 400', async () => {
    const res = await handleTriagePreview(post({}));
    expect(res.status).toBe(400);
  });
  test('잘못된 JSON → 400', async () => {
    const res = await handleTriagePreview(new Request('http://x', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/autopilot/arming — fail-closed 기본', () => {
  test('autopilot.json 없으면 전부 disarmed', async () => {
    const j = await handleArmingGet().json() as any;
    expect(j.ok).toBe(true);
    // 실 파일 부재 시 기본 disarmed(대표가 생성하지 않았다면).
    expect(typeof j.arming.absorb).toBe('boolean');
    expect(typeof j.arming.merge).toBe('boolean');
    expect(j.arming.reboot).toBe(false); // 재부팅은 항상 HITL
  });
});

describe('GET repo-watch / autonomy — 형태(tolerant)', () => {
  test('repo-watch: ok + repos 배열', async () => {
    const j = await handleRepoWatchGet().json() as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.repos)).toBe(true);
    // 감시 대상 3 repo 는 항상 포함(상태 없으면 null).
    expect(j.repos.length).toBeGreaterThanOrEqual(3);
    expect(j.repos.some((r: any) => r.key === 'codex')).toBe(true);
  });
  test('autonomy: ok + actions 배열', async () => {
    const req = new Request('http://x/v1/autopilot/autonomy?limit=5');
    const j = await handleAutonomyGet(req).json() as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.actions)).toBe(true);
  });
});
