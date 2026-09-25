import { expect, test } from 'bun:test';
import { parseVerifyLines, regressions } from './docker-verify-cycle.js';

const SAMPLE = `ubuntu:24.04  [verify] fix_rc=0 doctor_rc=0  manual: gh-auth provider-decision
debian:12  [verify] fix_rc=1 doctor_rc=0  manual: gh-auth provider-decision python-env
fedora:latest  build FAILED — /tmp/x/build-fedora-latest.log
amazonlinux:2023  [verify] fix_rc=0 doctor_rc=0  manual: none
logs: /tmp/x`;

test('parses every result line and ignores the rest', () => {
  const lines = parseVerifyLines(SAMPLE);
  expect(lines.map((l) => l.base)).toEqual(['ubuntu:24.04', 'debian:12', 'fedora:latest', 'amazonlinux:2023']);
  expect(lines[0]!.manual).toEqual(['gh-auth', 'provider-decision']);
  expect(lines[3]!.manual).toEqual([]);
});

test('login-only manuals are not regressions; fix_rc, extra manuals and build failures are', () => {
  expect(regressions(parseVerifyLines(SAMPLE))).toEqual([
    { base: 'debian:12', reason: 'fix_rc=1 · manual: python-env' },
    { base: 'fedora:latest', reason: 'image build failed' },
  ]);
});
