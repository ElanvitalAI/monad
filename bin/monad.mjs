#!/usr/bin/env bun
// ⛔ 이 파일이 **배포 엔트리**다. `src/index.ts` 는 여기서 import 되므로 그쪽의
//   `import.meta.main` 은 항상 false — 실행은 여기서 명시적으로 건다(#6701 회귀).
import { runCli } from '../src/index.ts';

runCli();
