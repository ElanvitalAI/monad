// GN (2026-07-18) — 네이티브 iOS/Android 앱 대화 소스 귀속. InputSourceKind 'native' →
// DaemonSessionOrigin 'native' 매핑 + 가드. taste substrate 가 "어느 서피스" 를 구분하도록.

import { test, expect } from 'bun:test';
import { deriveOriginFromInputSourceKind } from '../src/boot/daemon-session-origin-derive.js';
import { isDaemonSessionOrigin } from '../src/boot/daemon-runtime.js';
import { INPUT_SOURCE_KINDS } from '../src/input/input-source-kind.js';

test("deriveOriginFromInputSourceKind('native') === 'native'", () => {
  expect(deriveOriginFromInputSourceKind('native')).toBe('native');
});

test("기존 서피스 매핑 회귀 무손실", () => {
  expect(deriveOriginFromInputSourceKind('telegram')).toBe('tg');
  expect(deriveOriginFromInputSourceKind('discord')).toBe('dc');
  expect(deriveOriginFromInputSourceKind('pwa')).toBe('pwa');
  expect(deriveOriginFromInputSourceKind('daemon-api')).toBe('cli');
  // 무태깅 유지(회귀): voice/browser/terminal 등은 undefined
  expect(deriveOriginFromInputSourceKind('voice')).toBeUndefined();
});

test("'native' 는 InputSourceKind 배열 + DaemonSessionOrigin 가드에 존재", () => {
  expect(INPUT_SOURCE_KINDS.includes('native')).toBe(true);
  expect(isDaemonSessionOrigin('native')).toBe(true);
  expect(isDaemonSessionOrigin('bogus')).toBe(false);
});
