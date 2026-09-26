import { describe, expect, test } from 'bun:test';
import { checkPodPool, parsePodPool, PodPoolScheduler, resolvePodPoolSpec, syncPoolImage, syncPoolImages, type RemoteRun } from './pod-pool.js';
import { podSelfImplementSpawn, type Kubectl } from './self-implement-pod.js';

describe('pod pool — priority ⊕ per-node capacity', () => {
  test('parses context[@ssh][:capacity] in priority order', () => {
    expect(parsePodPool('pool-node-b@node-b:12, k3d-elanous-h1, pool-node-c@node-c:3')).toEqual([
      { context: 'pool-node-b', sshHost: 'node-b', capacity: 12, k3dCluster: 'elanous-pool' },
      { context: 'k3d-elanous-h1', capacity: 2, k3dCluster: 'elanous-h1' },
      { context: 'pool-node-c', sshHost: 'node-c', capacity: 3, k3dCluster: 'elanous-pool' },
    ]);
    expect(() => parsePodPool('a:0')).toThrow('상한은 1 이상');
    expect(() => parsePodPool('a,a')).toThrow('겹친다');
    expect(() => parsePodPool('bad node')).toThrow('못 읽는 노드');
  });

  test('explicit spec wins over env; neither → null (single current context)', () => {
    expect(resolvePodPoolSpec('a:1', { ELANOUS_POD_POOL: 'b:1' })).toBe('a:1');
    expect(resolvePodPoolSpec(undefined, { ELANOUS_POD_POOL: 'b:1' })).toBe('b:1');
    expect(resolvePodPoolSpec(undefined, {})).toBeNull();
  });

  test('fills the first node to capacity before spilling to the next; release reopens a slot', () => {
    const pool = new PodPoolScheduler(parsePodPool('first:2,second:1'));
    const got = [pool.tryAcquire(), pool.tryAcquire(), pool.tryAcquire(), pool.tryAcquire()].map((m) => m?.context ?? null);
    expect(got).toEqual(['first', 'first', 'second', null]);
    pool.release(pool.members[0]!);
    expect(pool.tryAcquire()?.context).toBe('first');
    expect(pool.snapshot()).toEqual({ first: 2, second: 1 });
  });

  test('check drops unreachable nodes with the reason, never silently', () => {
    const kubectl = (args: readonly string[]) => args[1] === 'bad'
      ? { status: 1, stdout: '', stderr: 'Unable to connect to the server: dial tcp: i/o timeout' }
      : { status: 0, stdout: 'elanous-test', stderr: '' };
    const r = checkPodPool(parsePodPool('good:1,bad:1'), kubectl);
    expect(r.ok).toBe(true);
    expect(r.ready.map((m) => m.context)).toEqual(['good']);
    expect(r.dropped).toEqual([{ context: 'bad', reason: 'Unable to connect to the server: dial tcp: i/o timeout' }]);
    expect(checkPodPool(parsePodPool('bad:1'), kubectl).ok).toBe(false);
  });

  test('image sync is a no-op for a local node and for a remote node already on the same commit', () => {
    const run: RemoteRun = () => ({ status: 0, stdout: 'abc123\n', stderr: '' });
    const [local, remote] = parsePodPool('k3d-elanous-h1:1,pool-node-b@node-b:1');
    expect(syncPoolImage(local!, 'img', 'abc123', run)).toMatchObject({ ok: true, action: 'local' });
    expect(syncPoolImage(remote!, 'img', 'abc123', run)).toMatchObject({ ok: true, action: 'fresh' });
  });

  test('every kubectl call of a pooled job carries that node\'s --context, and the slot is released', async () => {
    const calls: string[][] = [];
    const kubectl: Kubectl = (args) => {
      calls.push([...args]);
      if (args.includes('jsonpath={.status.conditions[*].type}')) return { status: 0, stdout: 'Complete', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const pool = new PodPoolScheduler(parsePodPool('pool-node-b@node-b:1'));
    const spawn = podSelfImplementSpawn({
      kubectl, pool, pollMs: 1, imageCommit: null, sleep: async () => {},
      credentials: () => ({ elanousAuth: '{}', codexAuth: '{}', ghToken: 't' }),
    });
    const done = await spawn({ spaceId: 's1', feature: 'f' } as Parameters<typeof spawn>[0]).done;
    expect(done.exitCode).toBe(0);
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((c) => c[0] === '--context' && c[1] === 'pool-node-b')).toBe(true);
    expect(pool.snapshot()).toEqual({ 'pool-node-b': 0 });
  });

  test('remote nodes sync in parallel via node-side build; a failed build falls back to shipping', async () => {
    const labels = new Map<string, string>([['node-b', 'old'], ['node-c', 'old']]);
    const run: RemoteRun = (host) => ({ status: 0, stdout: `${labels.get(host)}\n`, stderr: '' });
    const started: string[] = [];
    let inFlight = 0, maxInFlight = 0;
    const remoteBuild = async (host: string) => {
      started.push(host); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      if (host === 'node-c') return { ok: false, detail: 'keychain locked' };
      labels.set(host, 'new');
      return { ok: true, detail: 'built' };
    };
    const ship = (m: { sshHost?: string }) => { labels.set(m.sshHost!, 'new'); return { ok: true, action: 'shipped' as const, detail: 'old → new' }; };
    const r = await syncPoolImages(parsePodPool('k3d-elanous-h1:1,pool-node-b@node-b:2,pool-node-c@node-c:1'), 'img', 'new', { run, remoteBuild, ship });
    expect(maxInFlight).toBe(2);                       // 동시에
    expect(r.get('k3d-elanous-h1')?.action).toBe('local');
    expect(r.get('pool-node-b')).toMatchObject({ ok: true, action: 'built' });
    expect(r.get('pool-node-c')).toMatchObject({ ok: true, action: 'shipped' });
    expect(r.get('pool-node-c')!.detail).toContain('keychain locked');
    const again = await syncPoolImages(parsePodPool('pool-node-b@node-b:2'), 'img', 'new', { run, remoteBuild, ship });
    expect(again.get('pool-node-b')?.action).toBe('fresh');   // 같은 판이면 아무것도 안 한다
  });
});
