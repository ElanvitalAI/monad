// ── 🩸 「모른다」가 세 사실을 덮고 있었다 ────────────────────────────────────
//
// 실측 2026-09-08: `elan-tf-test`(실재·설정 없음)와 `no-such-bucket-f48`(없는 버킷)이
// ***똑같은 문장***을 냈다. ⛔ 오타와 권한 문제를 사용자가 못 가른다.
// 🚨 ⊕ 이 관문이 «붉어지는» 것만 봤고 ***초록을 한 번도 못 봤다*** — 그것도 시험이 문다.

import { describe, expect, test } from 'bun:test';

import { judgeArchiveBucket, type BucketProbe } from './archive-bucket-verdict.js';

const probe = (policy: Partial<BucketProbe['policy']>, block: Partial<BucketProbe['block']>): BucketProbe => ({
  policy: { ok: false, text: '', ...policy },
  block: { ok: false, text: '', ...block },
});
const isPublic = (j: string | null) => (j === null ? null : /"Principal":\s*"\*"/.test(j));
const isBlocked = (j: string | null) => (j === null ? null : !/false/.test(j));

describe('judgeArchiveBucket — ⛔ 세 실패를 가른다', () => {
  test('🩸 없는 버킷은 «없다»고 말한다 — 오타를 짚어 준다', () => {
    const v = judgeArchiveBucket('nope', probe({}, { text: 'NoSuchBucket: ...' }), isPublic, isBlocked);
    expect(v.state).toBe('missing');
    expect(v.why).toContain('오타');
    expect(v.remedy).toContain('aws s3 mb');
  });

  test('🩸 설정이 «없는» 실재 버킷은 다른 말을 한다 — AWS 기본이라 흔하다', () => {
    const v = judgeArchiveBucket('b', probe({}, { text: 'NoSuchPublicAccessBlockConfiguration' }), isPublic, isBlocked);
    expect(v.state).toBe('no-block-config');
    expect(v.why).toContain('있는데');
    expect(v.remedy).toContain('put-public-access-block');
  });

  test('권한 없음은 «또» 다른 말이다', () => {
    const v = judgeArchiveBucket('b', probe({}, { text: 'AccessDenied' }), isPublic, isBlocked);
    expect(v.state).toBe('unreadable');
    expect(v.remedy).toContain('--profile');
  });

  test('⛔ 셋 다 «거절»은 유지한다 — 모르면 남의 저작물을 안 올린다', () => {
    for (const t of ['NoSuchBucket', 'NoSuchPublicAccessBlockConfiguration', 'AccessDenied']) {
      expect(judgeArchiveBucket('b', probe({}, { text: t }), isPublic, isBlocked).ok).toBe(false);
    }
  });
});

describe('⭐ 초록으로 «간다» — 늘 거절하는 관문은 고장난 관문과 구별되지 않는다', () => {
  test('공개 차단 4/4 면 통과한다', () => {
    const v = judgeArchiveBucket('b', probe({}, { ok: true, text: '{"BlockPublicAcls":true}' }), isPublic, isBlocked);
    expect(v.ok).toBe(true);
    expect(v.state).toBe('blocked');
    expect(v.remedy).toBeNull();
  });

  test('부분 차단은 거절하되 «고치는 명령»을 준다', () => {
    const v = judgeArchiveBucket('b', probe({}, { ok: true, text: '{"BlockPublicAcls":false}' }), isPublic, isBlocked);
    expect(v.ok).toBe(false);
    expect(v.state).toBe('partially-blocked');
    expect(v.remedy).toContain('put-public-access-block');
  });

  test('⛔ 공개 정책은 «다른 버킷을 대라»고 한다 — 고쳐서 쓰라고 하지 않는다', () => {
    const v = judgeArchiveBucket('b', probe({ ok: true, text: '{"Principal": "*"}' }, {}), isPublic, isBlocked);
    expect(v.state).toBe('public-policy');
    expect(v.remedy).toContain('다른 비공개 버킷');
  });
});
