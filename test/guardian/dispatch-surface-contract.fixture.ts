import type { GuardianContext } from '../../src/guardian/types.js';
import type { ToolRuntimeContext } from '../../src/tool-runtime/types.js';
import type { VerifierContext } from '../../src/verifier/types.js';

declare const runtimeContext: ToolRuntimeContext;

type RuntimeSurface = ToolRuntimeContext['surface'];
// 🆕 'chat' (2026-09-07 · 대표) — PWA·안드로이드·iOS 챗에서 온 dispatch.
//   ⭐ 이 넓힘은 «의도»다 — 가디언·검증기가 「챗에서 왔나」로 갈릴 수 있어야 한다.
//      (승인 프롬프트를 붙이는 자리가 바로 이 축이다.)
//   📄 결정 = 내부 문서 `RFC-three-chat-surfaces-converge-2026-09-06` §8d
type ExpectedRuntimeSurface = 'dashboard' | 'skill' | 'tui' | 'mcp' | 'chat';
type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type _RuntimeSurfaceIsExpected = Assert<Equal<RuntimeSurface, ExpectedRuntimeSurface>>;
type _GuardianReceivesRuntimeSurface = Assert<Equal<GuardianContext['surface'], RuntimeSurface>>;
type _VerifierReceivesRuntimeSurface = Assert<Equal<VerifierContext['surface'], RuntimeSurface>>;

const guardianContext: GuardianContext = {
  toolId: 'dispatch-surface-contract',
  surface: runtimeContext.surface,
};

const verifierContext: VerifierContext = {
  toolId: 'dispatch-surface-contract',
  surface: runtimeContext.surface,
};

// `all` is catalog visibility, not a dispatch origin; missing and unknown origins
// must remain rejected by both hook contexts.
// @ts-expect-error `all` is not a runtime dispatch surface.
const allSurface: RuntimeSurface = 'all';
// @ts-expect-error runtime contexts require a concrete surface.
const missingSurface: RuntimeSurface = undefined;
// @ts-expect-error unknown origins are not runtime dispatch surfaces.
const invalidSurface: RuntimeSurface = 'invalid';

void guardianContext;
void verifierContext;
void allSurface;
void missingSurface;
void invalidSurface;
