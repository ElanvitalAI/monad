// ── 롱콘텐츠 spill — 긴 메시지/자료를 S3 업로드 + 링크로 대체 (공용 · 2026-07-10) ──
//
// 대표 지시: 메신저(telegram/discord/pushcut)뿐 아니라 챗 전반에서 너무 긴 메시지나
// 자료를 여러 조각으로 쪼개 보내는 대신 **S3 에 업로드하고 짧은 미리보기+링크**로
// 대체한다. surface-agnostic — outbound 라우터(전 메신저 수렴점)·클라 폴백·챗 서피스가
// 공용으로 쓴다. fail-soft: S3 불가/업로드 실패면 원문 그대로 반환(기존 분할 폴백 유지).
//
// 키 = content-hash → 동일 내용 dedupe(같은 링크 재사용). public-read 버킷이라 링크 즉시 열림.

import { createHash } from 'node:crypto';
import { s3MonadKey, s3PublicUrl, uploadText, isS3Available } from './s3.js';

export interface SpillOptions {
  /** 이 길이 초과 시 spill(기본 3500 — telegram 4096 안전 여유). */
  threshold?: number;
  /** 파일 확장자/렌더 타입(기본 txt). markdown 이면 md. */
  ext?: 'txt' | 'md';
  /** 링크 메시지에 남길 미리보기 길이(기본 500). */
  previewChars?: number;
  /** 업로드 주입(테스트/대체) — key 로 업로드하고 public URL 반환. null=실패.
   *  기본 = isS3Available 게이트 + s3.uploadText + s3PublicUrl. */
  upload?: (text: string, key: string, ext: 'txt' | 'md') => string | null;
}

export interface SpillResult {
  /** 채널에 실제 보낼 본문(spill 되면 미리보기+링크, 아니면 원문). */
  text: string;
  spilled: boolean;
  url?: string;
}

const CONTENT_TYPE: Record<'txt' | 'md', string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

/** 기본 업로드 — S3 가용할 때만. content-hash 키(dedupe). 실패 시 null(fail-soft). */
export function defaultSpillUpload(text: string, key: string, ext: 'txt' | 'md'): string | null {
  if (!isS3Available()) return null;
  try { uploadText(text, key, CONTENT_TYPE[ext]); return s3PublicUrl(key); }
  catch { return null; }
}

/** content 가 threshold 초과면 S3 업로드 후 미리보기+링크로 대체. 아니면 원문 그대로.
 *  업로드 실패/S3 불가면 원문 반환(spilled=false) — 호출측 기존 분할 폴백이 처리. */
export function spillLongContent(content: string, opts: SpillOptions = {}): SpillResult {
  const threshold = opts.threshold ?? 3500;
  if (content.length <= threshold) return { text: content, spilled: false };

  const ext = opts.ext ?? 'txt';
  const previewChars = opts.previewChars ?? 500;
  const upload = opts.upload ?? defaultSpillUpload;

  const hash = createHash('sha1').update(content).digest('hex').slice(0, 16);
  const key = s3MonadKey('spill', `${hash}.${ext}`);
  const url = upload(content, key, ext);
  if (!url) return { text: content, spilled: false }; // fail-soft — 원문 유지

  const preview = content.slice(0, previewChars).trimEnd();
  const text = `${preview}…\n\n📄 전체 ${content.length}자 · ${url}`;
  return { text, spilled: true, url };
}
