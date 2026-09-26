// 설치본 패키지 경로 — 의존성 없는 한 곳(leader.ts · config.ts 가 함께 쓴다 · 순환 import 없이).

/** 설치본 패키지가 사는 자리 — 설치기(`elanous` · tarball) ⊕ npm(`@elanvitalai/elanous` · 09-26 공개 스코프).
 *  ⛔ 한 곳에만 둔다: 이 목록을 모르는 판정은 npm 설치본을 «트리»로 읽어 작업 폴더의 우주로 떨어진다. */
export const INSTALLED_PACKAGE_MARKERS = ['/node_modules/elanous', '/node_modules/@elanvitalai/elanous'] as const;

export function isInstalledPackagePath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return INSTALLED_PACKAGE_MARKERS.some((m) => p.includes(`${m}/`) || p.endsWith(m));
}
