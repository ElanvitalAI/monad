// 네이티브 모듈(node-pty) 빌드 환경 — `node` 는 지금 도는 bun, `node-gyp` 는 최신판.
// 🩸 2026-09-24 빈 GCP Ubuntu 24.04 실측: codex CLI 용으로 apt `nodejs npm` 을 깔면 PATH 의 `node`(v18)·`node-gyp`(apt 9.3.0)가
//    node-pty 빌드를 잡는다 → 그 바이너리를 bun 이 불러오는 순간 `panic: unsupported uv function: uv_version_string` 로
//    프로세스가 «죽는다»(doctor 도 · 데몬의 PTY 도). node 가 없던 기계에서는 bun 이 `bun x node-gyp@latest` 로 빌드해 됐다.
//    ⇒ 빌드 때만 PATH 앞에 심 폴더를 붙여 그 조건을 «어느 기계에서나» 만든다.
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export function nativeBuildShimDir(bunPath: string = process.execPath, base: string = tmpdir()): string {
  const dir = mkdtempSync(join(base, 'elanous-native-build-'));
  symlinkSync(bunPath, join(dir, 'node'));
  const gyp = join(dir, 'node-gyp');
  writeFileSync(gyp, `#!/bin/sh\nexec "${bunPath}" x node-gyp@latest "$@"\n`);
  chmodSync(gyp, 0o755);
  return dir;
}

export function nativeBuildEnv(env: NodeJS.ProcessEnv, shimDir: string): NodeJS.ProcessEnv {
  return { ...env, PATH: [shimDir, env.PATH ?? ''].filter(Boolean).join(delimiter) };
}
