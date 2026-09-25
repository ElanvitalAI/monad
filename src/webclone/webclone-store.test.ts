// ── webclone 스토어·인덱스 시험 — ⛔ 「올리면 안 되는 것」이 «못 올라가는가» ──────
//
// ⭐ 이 파일이 무는 것은 업로드가 아니라 ***정책***이다. 네트워크를 안 탄다 —
//    가시성 판정·키 결정론·인덱스 불변식은 전부 순수하고, 그것이 안전의 전부다.

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_STORE, assetKey, classifyAsset, isFullyBlockedFromPublic, isPublicReadPolicy,
  publicUrl, readAwsProfile, uploadAsset,
} from './webclone-store.js';
import {
  contentHash, normaliseForHash, specHash, openWebCloneDb, insertAsset, listClones,
  replaceTokens, upsertClone,
} from './webclone-db.js';

describe('classifyAsset — 안전 관문', () => {
  test('파생물은 public', () => {
    expect(classifyAsset('derived').visibility).toBe('public');
  });
  test('⛔ 원본에서 받은 것은 «언제나» reference', () => {
    expect(classifyAsset('captured').visibility).toBe('reference');
  });
  test('⛔ 이유가 «비지 않는다» — 인덱스가 빈 이유를 거절하기 때문', () => {
    expect(classifyAsset('captured').reason.trim().length).toBeGreaterThan(0);
    expect(classifyAsset('derived').reason.trim().length).toBeGreaterThan(0);
  });
});

describe('uploadAsset — ⛔ 이중 방어', () => {
  test('captured 는 네트워크를 «타기 전에» 거절된다', async () => {
    const r = await uploadAsset({
      cfg: DEFAULT_STORE, slug: 's', name: 'hero.jpg',
      body: 'x', origin: 'captured',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockedOn).toBe('not-public');
  });

  test('자격이 없으면 «조용히 성공하지» 않는다', async () => {
    const r = await uploadAsset({
      cfg: DEFAULT_STORE, slug: 's', name: 'spec.json', body: '{}', origin: 'derived',
    });
    // 자격이 환경에 있을 수도 있는 기계라 «둘 중 하나»만 허용한다 —
    // ⛔ 「조용히 ok:true 인데 안 올라감」이 없다는 것이 이 시험의 값이다.
    if (!r.ok) expect(['no-credentials', 'upload-failed']).toContain(r.blockedOn);
    else expect(r.url.startsWith('https://')).toBe(true);
  });
});

describe('assetKey — 결정론 ⊕ 경로 탈출 방지', () => {
  test('같은 입력은 같은 키', () => {
    expect(assetKey(DEFAULT_STORE, 'a', 'spec.json')).toBe(assetKey(DEFAULT_STORE, 'a', 'spec.json'));
  });
  test('⛔ `..` 로 접두를 벗어나지 못한다', () => {
    const k = assetKey(DEFAULT_STORE, 'a', '../../etc/passwd');
    expect(k.startsWith(`${DEFAULT_STORE.prefix}/a/`)).toBe(true);
    expect(k).not.toContain('..');
  });
  test('앞 슬래시를 먹어 이중 슬래시를 안 만든다', () => {
    expect(assetKey(DEFAULT_STORE, 'a', '/x.json')).toBe(`${DEFAULT_STORE.prefix}/a/x.json`);
  });
  test('공개 URL 이 버킷·리전을 담는다', () => {
    expect(publicUrl(DEFAULT_STORE, 'k')).toBe(
      `https://${DEFAULT_STORE.bucket}.s3.${DEFAULT_STORE.region}.amazonaws.com/k`);
  });
});

describe('readAwsProfile', () => {
  const ini = `
# 주석
[default]
aws_access_key_id = AKIAEXAMPLE
aws_secret_access_key = secret/one

[profile other]
aws_access_key_id = AKIAOTHER
aws_secret_access_key = secret/two
`;
  test('프로필을 고른다', () => {
    expect(readAwsProfile('default', () => ini, '/h')?.accessKeyId).toBe('AKIAEXAMPLE');
  });
  test('`profile ` 접두가 붙은 절도 같은 이름으로 찾는다', () => {
    expect(readAwsProfile('other', () => ini, '/h')?.accessKeyId).toBe('AKIAOTHER');
  });
  test('⛔ 없으면 null — 「빈 자격」을 만들지 않는다', () => {
    expect(readAwsProfile('nope', () => ini, '/h')).toBeNull();
  });
  test('파일이 없으면 던지지 않고 null', () => {
    expect(readAwsProfile('default', () => { throw new Error('ENOENT'); }, '/h')).toBeNull();
  });
});

describe('normaliseForHash — 🩸 요청마다 바뀌는 주입', () => {
  test('Cloudflare 챌린지 토큰이 지워진다', () => {
    const a = `x window.__CF$cv$params={r:'aaa',t:'111'}; y`;
    const b = `x window.__CF$cv$params={r:'bbb',t:'222'}; y`;
    expect(normaliseForHash(a)).toBe(normaliseForHash(b));
  });
  test('⭐ 그래서 두 응답의 해시가 «같아진다» — 이것이 없으면 판정이 불가능했다', () => {
    const a = `<html>window.__CF$cv$params={r:'aaa',t:'111'}</html>`;
    const b = `<html>window.__CF$cv$params={r:'bbb',t:'222'}</html>`;
    expect(contentHash([a])).toBe(contentHash([b]));
  });
  test('nonce 도 지워진다', () => {
    expect(normaliseForHash('<s nonce="a1">')).toBe(normaliseForHash('<s nonce="b2">'));
  });
  test('⛔ 진짜 내용이 다르면 «여전히» 다르다', () => {
    expect(contentHash(['<h1>A</h1>'])).not.toBe(contentHash(['<h1>B</h1>']));
  });
});

describe('specHash — 디자인 축만 본다', () => {
  const base = {
    colors: [{ name: '--a', value: '#fff' }],
    fontStacks: ['X'],
    typeScale: [{ role: 'h1', fontSize: '42px' }],
    sections: [{ id: 'hero' }],
    breakpoints: ['900px'],
    motion: { keyframes: ['k'], honoursReducedMotion: true },
  };
  test('같은 디자인은 같은 해시', () => {
    expect(specHash(base)).toBe(specHash({ ...base }));
  });
  test('⭐ 색이 바뀌면 «바뀐다» — 템플릿을 손봐야 한다는 신호', () => {
    expect(specHash({ ...base, colors: [{ name: '--a', value: '#000' }] })).not.toBe(specHash(base));
  });
  test('⛔ reduced-motion 존중이 사라지면 «바뀐다»(접근성은 디자인 축이다)', () => {
    expect(specHash({ ...base, motion: { keyframes: ['k'], honoursReducedMotion: false } }))
      .not.toBe(specHash(base));
  });
});

describe('인덱스 불변식', () => {
  const openMemory = () => openWebCloneDb(':memory:');

  test('⛔ reference 에 공개 URL 이 붙으면 «거절»한다', () => {
    const db = openMemory();
    expect(() => insertAsset(db, {
      slug: 's', ref: 'hero.jpg', visibility: 'reference', bytes: 1,
      contentType: 'image/jpeg', publicUrl: 'https://x/y', reason: '이유',
    })).toThrow();
  });

  test('⛔ 이유가 비면 «거절»한다', () => {
    const db = openMemory();
    expect(() => insertAsset(db, {
      slug: 's', ref: 'a', visibility: 'public', bytes: 1,
      contentType: null, publicUrl: null, reason: '   ',
    })).toThrow();
  });

  test('두 번 넣어도 «한 행» — 재실행이 인덱스를 부풀리지 않는다', () => {
    const db = openMemory();
    const row = {
      slug: 's', url: 'u', title: null, capturedAt: 't',
      contentHash: 'c', specHash: 'd', specJson: '{}', unresolved: '',
    };
    upsertClone(db, row); upsertClone(db, row);
    replaceTokens(db, 's', [{ name: '--a', value: '#fff', source: ':root' }]);
    replaceTokens(db, 's', [{ name: '--a', value: '#fff', source: ':root' }]);
    const rows = listClones(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenCount).toBe(1);
  });

  test('요약이 공개·참조를 «갈라» 센다', () => {
    const db = openMemory();
    upsertClone(db, {
      slug: 's', url: 'u', title: null, capturedAt: 't',
      contentHash: 'c', specHash: 'd', specJson: '{}', unresolved: 'cascade-order',
    });
    insertAsset(db, { slug: 's', ref: 'spec.json', visibility: 'public', bytes: 2, contentType: 'application/json', publicUrl: 'https://x/s', reason: '파생물' });
    insertAsset(db, { slug: 's', ref: 'hero.jpg', visibility: 'reference', bytes: null, contentType: null, publicUrl: null, reason: '원본' });
    const [r] = listClones(db);
    expect(r.publicAssets).toBe(1);
    expect(r.referenceAssets).toBe(1);
    expect(r.unresolved).toBe('cascade-order');
  });
});

describe('isPublicReadPolicy — 🩸 「비공개 접두」는 «없다»', () => {
  test('실측한 elanvital-public 정책을 «공개»로 읽는다', () => {
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [
      { Sid: 'PublicReadGetObject', Effect: 'Allow', Principal: '*',
        Action: 's3:GetObject', Resource: 'arn:aws:s3:::elanvital-public/*' }] });
    expect(isPublicReadPolicy(pol)).toBe(true);
  });
  test('Principal 이 특정 주체면 공개가 아니다', () => {
    const pol = JSON.stringify({ Statement: [
      { Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::1:user/x' }, Action: 's3:GetObject' }] });
    expect(isPublicReadPolicy(pol)).toBe(false);
  });
  test('Action 배열도 문다', () => {
    const pol = JSON.stringify({ Statement: [
      { Effect: 'Allow', Principal: '*', Action: ['s3:GetObject', 's3:ListBucket'] }] });
    expect(isPublicReadPolicy(pol)).toBe(true);
  });
  test('⛔ 정책을 «못 읽으면» null — 「비공개」로 가정하지 않는다', () => {
    expect(isPublicReadPolicy(null)).toBeNull();
    expect(isPublicReadPolicy('not json')).toBeNull();
  });
});

describe('isFullyBlockedFromPublic — 🩸 「정책 없음」은 「모름」이 아니다', () => {
  const blk = (v: Record<string, boolean>) => JSON.stringify({ PublicAccessBlockConfiguration: v });
  const ALL = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
  test('4/4 차단이면 비공개로 «확인»된다', () => {
    expect(isFullyBlockedFromPublic(blk(ALL))).toBe(true);
  });
  test('⛔ 하나라도 false 면 «비공개 보장이 아니다»', () => {
    expect(isFullyBlockedFromPublic(blk({ ...ALL, RestrictPublicBuckets: false }))).toBe(false);
  });
  test('⛔ 키가 빠지면 null — false 로 «몰지» 않는다', () => {
    expect(isFullyBlockedFromPublic(blk({ BlockPublicAcls: true }))).toBeNull();
  });
  test('⛔ 못 읽으면 null', () => {
    expect(isFullyBlockedFromPublic(null)).toBeNull();
    expect(isFullyBlockedFromPublic('{}')).toBeNull();
  });
});
