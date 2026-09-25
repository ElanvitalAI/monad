// ── 원문 보관 버킷 판정 — ⛔ 「모른다」를 «세 가지»로 가른다 (2026-09-08) ────────
//
// 🩸 계기: 실측에서 ***세 사실이 한 문장***으로 나왔다.
//    `elan-tf-test`(실재·설정 없음) · `no-such-bucket-f48`(없는 버킷) 이
//    똑같이 *"공개 여부를 «못 읽었다»"* 를 냈다. ⛔ 오타와 권한 문제를 사용자가 못 가른다.
// 🚨 그리고 더 큰 것: 내가 이 관문이 «붉어지는» 것만 봤고 ***초록으로 가는 것을 한 번도 못 봤다***.
//    실재 버킷 둘·없는 버킷 하나 = 3/3 거절. 늘 거절하는 관문은 «고장난 관문»과 구별되지 않는다.
//
// ⛔ 그래도 «기본은 거절»을 유지한다 — 남의 저작물을 올리는 축이라 모르면 안 올리는 쪽이 맞다.
//    바꾸는 것은 「거절하느냐」가 아니라 ***「왜 거절하는지, 무엇을 하면 되는지」***다.

export type BucketState =
  /** 공개 읽기 정책이 붙어 있다 — 가장 강한 거절 신호. */
  | 'public-policy'
  /** 공개 차단 4/4 — 비공개로 «확인»됨. ⭐ 이것만 통과다. */
  | 'blocked'
  /** 공개 차단이 부분적이다. */
  | 'partially-blocked'
  /** 버킷이 «없다»(오타이거나 아직 안 만들었다). */
  | 'missing'
  /** 버킷은 있는데 공개 차단 «설정 자체»가 없다 — AWS 기본이라 흔하다. */
  | 'no-block-config'
  /** 권한이 없어 «못 읽었다». */
  | 'unreadable';

export interface BucketProbe {
  /** `get-bucket-policy` 결과. 성공이면 정책 문자열, 실패면 stderr. */
  readonly policy: { ok: boolean; text: string };
  /** `get-public-access-block` 결과. */
  readonly block: { ok: boolean; text: string };
}

export interface BucketVerdict {
  readonly ok: boolean;
  readonly state: BucketState;
  readonly why: string;
  /** ⭐ 거절일 때 «무엇을 하면 되는지». 없으면 null — ⛔ 빈 문자열로 채우지 않는다. */
  readonly remedy: string | null;
}

/** stderr 로 세 실패를 가른다. ⛔ 「실패」 하나로 접으면 오타와 권한이 같아진다. */
function classifyBlockFailure(stderr: string): 'missing' | 'no-block-config' | 'unreadable' {
  if (/NoSuchBucket/i.test(stderr)) return 'missing';
  if (/NoSuchPublicAccessBlockConfiguration/i.test(stderr)) return 'no-block-config';
  return 'unreadable';
}

export function judgeArchiveBucket(
  bucket: string,
  probe: BucketProbe,
  isPublicReadPolicy: (json: string | null) => boolean | null,
  isFullyBlockedFromPublic: (json: string | null) => boolean | null,
): BucketVerdict {
  if (probe.policy.ok && isPublicReadPolicy(probe.policy.text.trim() || null) === true) {
    return {
      ok: false, state: 'public-policy',
      why: '⛔ 그 버킷은 «공개 읽기» 정책을 갖는다 — 원문을 올리면 공개 재배포가 된다',
      remedy: '⛔ 이 버킷은 쓰지 마라. 다른 비공개 버킷을 대라.',
    };
  }

  if (probe.block.ok) {
    const blocked = isFullyBlockedFromPublic(probe.block.text.trim() || null);
    if (blocked === true) return { ok: true, state: 'blocked', why: '공개 차단 4/4 — 비공개로 «확인»됨', remedy: null };
    if (blocked === false) {
      return {
        ok: false, state: 'partially-blocked',
        why: '⛔ 공개 차단이 «완전하지 않다» — 부분 차단은 비공개 보장이 아니다',
        remedy: `aws s3api put-public-access-block --bucket ${bucket} `
          + '--public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
      };
    }
  }

  const state = classifyBlockFailure(probe.block.text);
  if (state === 'missing') {
    return {
      ok: false, state,
      why: `⛔ 버킷 «${bucket}» 이 없다 — 오타이거나 아직 안 만들었다`,
      remedy: `aws s3 mb s3://${bucket} 로 만든 뒤 공개 차단을 걸어라(아래 명령).`,
    };
  }
  if (state === 'no-block-config') {
    return {
      ok: false, state,
      why: `⚠️ 버킷 «${bucket}» 은 «있는데» 공개 차단 «설정 자체»가 없다 — AWS 기본이라 흔하다. `
        + '⛔ 「설정이 없다」를 「비공개다」로 읽지 않는다(ACL 로 열려 있을 수 있다).',
      remedy: `aws s3api put-public-access-block --bucket ${bucket} `
        + '--public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
    };
  }
  return {
    ok: false, state: 'unreadable',
    why: '공개 여부를 «못 읽었다» — 권한이 없다. 모르는 채로 원문을 안 올린다',
    remedy: 's3:GetBucketPolicy · s3:GetBucketPublicAccessBlock 권한을 주거나, 권한이 있는 프로필을 --profile 로 대라.',
  };
}
