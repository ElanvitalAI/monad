// ── Read 파일-경로 인자 단일 출처 — turn 조립기 통일 Phase 4a (2026-07-22) ──
//
// 코딩코어의 두 Read 실구현(skills/tools/read.ts=file_path·daemon-tools/read.ts=path)이 파일 경로
// 인자 이름에서 드리프트했다 — 같은 daemon 서피스에서 Edit/Write 는 file_path 인데 Read 만 path 였고,
// 모델이 Claude-Code 표준 file_path 를 daemon Read 에 보내면 "path arg must be a string" 으로 실패했다.
//
// Phase 4a: 파일 경로 인자 해석을 단일 출처로 수렴 — **file_path canonical + path 레거시 별칭**. 두
// 구현이 이 리졸버를 공유해 어느 이름으로 와도 받는다(backward-compatible·모델 실패 제거). 스키마도
// file_path 를 표준으로 광고(Edit/Write 와 정합)하되 path 를 계속 수용.
//
// ⚠️ Phase 4b(전면 단일 구현 병합 — 출력 형태·보안 deny-list 정책 통일)는 별개. 여기는 인자 이름
//    드리프트만 해소(보안/출력/특화 무접촉). daemon 의 credential deny-list = 원격 서피스 트러스트
//    경계라 정책 통일은 대표 결정 필요.

/** file_path(canonical) ?? path(레거시 별칭) 를 trim 해 반환. 둘 다 없으면 ''(호출처가 required 검증). */
export function resolveReadPathArg(args: Record<string, unknown>): string {
  const fp = typeof args.file_path === 'string' ? args.file_path.trim() : '';
  if (fp) return fp;
  const p = typeof args.path === 'string' ? args.path.trim() : '';
  return p;
}

/** Read 스키마의 파일-경로 프로퍼티(file_path canonical + path 레거시 별칭). 각 서피스가 자기
 *  offset/limit/pages 등 추가 프로퍼티와 병합해 광고. daemon Edit/Write 의 file_path 와 정합. */
export const READ_PATH_SCHEMA_PROPS = {
  file_path: {
    type: 'string' as const,
    description:
      'Path to the file to read. Absolute paths (`/Users/...`) preferred; `~/...` expands HOME; ' +
      'relative paths resolve against the current working directory.',
  },
  path: {
    type: 'string' as const,
    description: 'Legacy alias for `file_path` (accepted for backward compatibility — prefer `file_path`).',
  },
};
