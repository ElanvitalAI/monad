import { describe, expect, test } from 'bun:test';
import { detectDistroFamily, parseOsRelease, remediesFor } from './doctor-distro.js';
import { checkReadiness } from './doctor-readiness.js';

// os-release 픽스처 — 각 배포판이 실제로 싣는 형식(따옴표·ID_LIKE 공백 목록)을 따른다(RFC 표의 네 기계 · 2026-09-24).
const UBUNTU_2404 = `PRETTY_NAME="Ubuntu 24.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
ID=ubuntu
ID_LIKE=debian`;
const AL2023 = `NAME="Amazon Linux"
VERSION="2023"
ID="amzn"
ID_LIKE="fedora"
VERSION_ID="2023"`;
const AL2 = `NAME="Amazon Linux"
VERSION="2"
ID="amzn"
ID_LIKE="centos rhel fedora"
VERSION_ID="2"`;
const ALPINE = `NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.20.3`;

describe('doctor-distro', () => {
  test('parses quoted and unquoted os-release values', () => {
    expect(parseOsRelease(AL2)).toMatchObject({ ID: 'amzn', ID_LIKE: 'centos rhel fedora', VERSION_ID: '2' });
    expect(parseOsRelease(UBUNTU_2404)).toMatchObject({ ID: 'ubuntu', ID_LIKE: 'debian' });
  });

  test('classifies the four measured machines and leaves others unknown', () => {
    expect(detectDistroFamily('linux', UBUNTU_2404)).toBe('debian');
    expect(detectDistroFamily('linux', AL2023)).toBe('amzn2023');
    expect(detectDistroFamily('linux', AL2)).toBe('amzn2');
    expect(detectDistroFamily('linux', ALPINE)).toBe('unknown');
    expect(detectDistroFamily('linux', null)).toBe('unknown');
    expect(detectDistroFamily('darwin', null)).toBe('darwin');
  });

  // 🩸 2026-09-25 배포판 컨테이너 매트릭스
  test('AL2023 gets no ripgrep line (not in its repos); Fedora installs gh from its own repo; AL2 gh brings yum-utils', () => {
    expect(remediesFor('amzn2023')?.rg).toBeUndefined();
    expect(remediesFor('fedora')?.gh).toBe('sudo dnf install -y gh');
    expect(remediesFor('amzn2')?.gh).toStartWith('sudo yum install -y yum-utils && ');
  });

  test('Amazon Linux never gets an apt command; an unknown family gets no guessed command', () => {
    for (const release of [AL2023, AL2]) {
      const remedies = remediesFor(detectDistroFamily('linux', release))!;
      expect(`${remedies.buildToolchain} ${remedies.pythonBuildDeps} ${remedies.gh}`).not.toContain('apt-get');
    }
    expect(remediesFor(detectDistroFamily('linux', AL2))?.pythonBuildDeps).toContain('openssl11-devel');
    expect(remediesFor(detectDistroFamily('linux', ALPINE))).toBeUndefined();
  });

  test('harness remedies use the measured family and leave unknown families without guessed commands', () => {
    expect(remediesFor('debian')).toMatchObject({ rg: 'sudo apt-get update && sudo apt-get install -y ripgrep', node: 'sudo apt-get update && sudo apt-get install -y nodejs npm', codex: 'sudo npm install -g @openai/codex' });
    expect(remediesFor('fedora')).toMatchObject({ rg: 'sudo dnf install -y ripgrep', node: 'sudo dnf install -y nodejs npm', codex: 'sudo npm install -g @openai/codex' });
    // AL2: 기본 저장소에 ripgrep·nodejs 가 없다 — 제3자 저장소를 자동으로 붙이지 않는다(이름만).
    expect(remediesFor('amzn2')?.rg).toBeUndefined();
    expect(remediesFor('amzn2')?.node).toBeUndefined();
    expect(remediesFor('amzn2')?.codex).toBe('sudo npm install -g @openai/codex');
    expect(remediesFor('amzn2')?.note).toContain('install them manually');
    expect(remediesFor('darwin')).toMatchObject({ rg: 'brew install ripgrep', node: 'brew install node', codex: 'npm install -g @openai/codex' });
    expect(remediesFor('unknown')).toBeUndefined();
  });

  test('gh readiness follows the distro family when it was measured, and keeps the old default when it was not', () => {
    const gh = (deps: Parameters<typeof checkReadiness>[0]) => checkReadiness(deps).items.find((entry) => entry.id === 'gh-auth')!;
    expect(gh({ ghOnPath: false, platform: 'linux', distro: 'fedora' }).remedy).toContain('dnf');
    expect(gh({ ghOnPath: false, platform: 'linux', distro: 'amzn2' }).remedy).toContain('yum');
    expect(gh({ ghOnPath: false, platform: 'darwin', distro: 'darwin' }).remedy).toBe('brew install gh');
    expect(gh({ ghOnPath: false, platform: 'linux', distro: 'unknown' }).remedy).toBeUndefined();
    // Debian 계열·못 잰 리눅스는 apt gh 가 최소 판 미만이라 고정 판 정적 gh(09-25 GCP debian-12 실측).
    expect(gh({ ghOnPath: false, platform: 'linux' }).remedy).toBe('monad doctor --fix --yes');
    expect(gh({ ghOnPath: false, platform: 'linux', distro: 'debian' }).remedy).toBe('monad doctor --fix --yes');
  });
});
