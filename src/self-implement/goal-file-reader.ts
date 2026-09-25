import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { TextDecoder } from 'node:util';

import { anchoredResolve } from '../boot/daemon-tools/path-guard.js';
import { ToolSafetyError } from '../boot/daemon-tools/types.js';

export type ReferencedFileReadResult =
  | { kind: 'ok'; contents: string }
  | { kind: 'missing' }
  | { kind: 'directory' }
  | { kind: 'outside-repository' }
  | { kind: 'read-error' }
  /**
   * ⭐ 이미지 — 텍스트가 아니지만 **읽을 수 있는** 참조다(`P4b`).
   *
   * ⛔ 종전엔 이런 파일이 전부 `not-text` 로 «거절»됐다. 그런데 실측(2026-08-07)으로
   * ***리뷰 백엔드 «둘 다» 이미지를 받는다***가 값으로 확인됐다 —
   * `claude`(ACP `image: true`) ⊕ `codex-app-server`(`CODEX_APP_SERVER_CAPS.prompt.image = true` ·
   * `UserInput.localImage` 로 materialise). 즉 막고 있던 것은 백엔드가 아니라 **이 리더**였다.
   *
   * `data` 는 base64 다 — ACP `ContentBlock` 의 이미지 표현과 같은 모양이라 그대로 실린다.
   */
  | { kind: 'image'; mimeType: string; data: string }
  | { kind: 'not-text' };

/**
 * 인라인으로 실을 수 있는 이미지 상한. ⛔ 없으면 임의 크기 파일이 base64(원본 ×4/3)로 메모리에 올라가고
 * 그대로 wire 로 나간다(`#7486` 리뷰 must-fix). 이 저장소의 다른 인라인 첨부도 10MB 를 쓴다
 * (`boot/attachment-store.ts` `MAX_BYTES`) — 같은 수를 쓴다.
 *
 * ⚠️ 초과는 `not-text` 로 돌려보낸다 — 「이미지인데 너무 크다」를 별도 kind 로 만들면 모든 소비처가
 * 새 갈래를 배워야 하고, 그 갈래를 안 배운 곳에서 조용히 실패한다. 「못 실었다」는 사실은 같다.
 */
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * 매직 바이트 → mime. ⛔ **확장자를 안 믿는다** — 리뷰 컨텍스트는 사용자가 대는 경로라
 * `.png` 로 끝나는 텍스트도, 확장자 없는 진짜 PNG 도 온다. 내용이 진실이다.
 *
 * ⚠️ 여기 «없는» 형식은 종전대로 `not-text` 로 간다 — 모르는 바이너리를 이미지라고
 * 우기면 백엔드가 거절하고, 그 거절은 이 층보다 훨씬 읽기 어려운 자리에서 난다.
 */

/** 매직 바이트 판별에 필요한 앞부분만 읽는다 — 초대형 파일을 통째로 안 올리기 위한 것이다. */
function readHeader(path: string, length = 16): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, 0));
  } finally {
    closeSync(fd);
  }
}

function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export type ReferencedFileReader = (repositoryRelativePath: string) => ReferencedFileReadResult;

/** Read a repository-relative text file without permitting lexical or symlink escapes. */
export function createRepositoryReferencedFileReader(repositoryRoot: string): ReferencedFileReader {
  return (repositoryRelativePath) => {
    let path: string;
    try {
      path = anchoredResolve(repositoryRelativePath, repositoryRoot);
    } catch (error) {
      // `anchoredResolve` 는 탈출에만 ToolSafetyError 를 던진다. 그 밖의 해석 실패(ELOOP·EACCES 등)는
      // 어휘 경로를 그대로 돌려주므로 아래 read 가 그것을 분류한다 — 전역 계약을 바꾸지 않는다(리뷰 must-fix).
      if (error instanceof ToolSafetyError) return { kind: 'outside-repository' };
      return { kind: 'read-error' };
    }
    try {
      // ⛔⭐⭐ 크기를 «읽기 전에» 보되, ***상한은 이미지에만 건다***.
      //   ⑴ readFileSync 뒤에 검사하면 초대형 파일이 «이미 메모리에» 올라간 뒤라 OOM 을 못 막는다.
      //   ⑵ 그렇다고 «모든» 큰 파일을 not-text 로 접으면, 이 리더를 공유하는 authored goal 문서가
      //      갑자기 «못 읽는 파일»이 된다 — 내가 그 회귀를 한 번 냈고 리뷰가 잡았다(`#7486`).
      //   ⇒ 큰 파일이면 «헤더만» 읽어 이미지인지 보고, 이미지일 때만 거절한다. 아니면 종전 그대로.
      const stat = statSync(path);
      if (stat.isDirectory()) return { kind: 'directory' };
      if (stat.size > MAX_INLINE_IMAGE_BYTES && sniffImageMime(readHeader(path))) {
        return { kind: 'not-text' };
      }
      const bytes = readFileSync(path);
      // ⭐ NUL 검사 «앞»에서 본다 — 이미지는 거의 항상 NUL 을 담으므로 뒤에 두면 영영 안 닿는다.
      const imageMime = sniffImageMime(bytes);
      if (imageMime) return { kind: 'image', mimeType: imageMime, data: bytes.toString('base64') };
      if (bytes.includes(0)) return { kind: 'not-text' };
      try {
        return { kind: 'ok', contents: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
      } catch {
        return { kind: 'not-text' };
      }
    } catch (error) {
      // ⛔ 부재는 두 코드로 온다 — 마지막 성분이 없으면 ENOENT, **중간 성분이 파일이면 ENOTDIR**
      //   (`src/index.ts/foo.ts`). ENOTDIR 를 read-error 로 두면 없는 경로가 "읽기 실패" 로 오분류된다.
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? { kind: 'missing' } : { kind: 'read-error' };
    }
  };
}
