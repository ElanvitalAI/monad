// ── 영상 생산 «능력» 레지스트리 ────────────────────────────────────────────
//
// ⭐⭐ 핵심 구분: 노드는 «능력»을 요구하고, 능력은 «구현»이 채운다.
//    노드가 도구 이름을 직접 부르면 그 도구가 없는 기계에서 파이프라인이 통째로 죽는다.
//    AX 컨설팅에서는 고객 기계에 DaVinci·AE 가 «없는» 것이 기본값이다.
//
// 계층 셋:
//   free     설치만 하면 되고 돈이 안 든다 (OSS · OS 내장)
//   owned    한 번 사거나 이미 깔려 있다 (Affinity · Adobe · Resolve · FCP)
//   metered  쓸 때마다 과금된다 (Higgsfield · ElevenLabs)
//
// ⛔ 「유료가 더 좋다」가 아니라 ***「유료는 품질·속도를 산다」***다.
//    📏 2026-09-22 실측: free 라인만으로 ***생성을 뺀 전 구간이 닫힌다***.

import { mediaSshHost } from '../ssh/ssh-hosts.js';

/** ssh 로 MLX 미디어 모델을 부를 호스트 — `MONAD_MEDIA_HOST` 또는 ssh-hosts.json 의 `media` 역할.
 *  (2026-09-25: 한 사람의 기계 이름이 박혀 있던 자리.) 없으면 센티널 — 탐침이 ssh 를 «안» 하고 「못 쟀다」로 답한다. */
export const UNSET_MEDIA_HOST = 'no-media-host';
export const MEDIA_HOST: string = mediaSshHost() ?? UNSET_MEDIA_HOST;
export type Tier = 'free' | 'owned' | 'metered';

/**
 * ⛔⭐⭐ ***「이 구현을 쓰려고 사용자가 «새로» 계정·키를 대야 하나」*** — 2026-09-22 신설.
 *
 * 🩸 계기: 대표 지시로 자원 맵(`catalog/resources.yaml`)과 이 파일을 맞춰 보니 ***겹침이 «1»*** 이었다.
 *   그런데 그것은 결함이 아니라 ***두 자산이 «다른 것을 색인»***하기 때문이다 —
 *   자원 맵은 «계정/키»를, 이 파일은 «능력과 구현»을 색인한다.
 *   📏 실측: free 구현 24 중 ***17개는 provider 가 «아예 없다»***(ffmpeg · imagemagick · sox · sips · yt-dlp …).
 *      계정이 «원리상» 없으므로 자격 색인에 못 들어온다. 넣으면 그 맵이 망가진다.
 *
 * 🔑 ⇒ 어휘를 합치지 않는다. 대신 ***오픈코어 경계가 «정말» 묻는 하나의 불린***을 여기서 낸다.
 *   그것이 `needsAccount` 다. 두 자산이 각자 이 불린을 내고 경계 계산기가 OR 한다.
 *
 * ⛔ `tier` 와 «다른 축»이다 — 실물 사례가 이 파일 안에 있었다:
 *   `bridge-ae`·`bridge-premiere`·`bridge-blender` 는 `tier: 'owned'`(앱을 이미 샀다)인데
 *   ***브리지 자체가 `bridge.higgsfield.ai` 의 OAuth 를 탄다***(설정에 `oauthIssuer` 가 있다).
 *   ⇒ 「앱을 샀다」가 「계정이 필요 없다」를 «뜻하지 않는다». 종전엔 그 셋에 `provider` 가 비어 있어
 *     ***higgsfield 계정이 필요하다는 사실이 통째로 안 보였다.***
 *
 * ⛔ `higgsfield` 와 `higgsfield-bridge` 는 ***다른 provider 다***(같은 회사·다른 자격 경로):
 *   전자는 클라우드 생성 CLI(`probe: cmd`), 후자는 로컬 앱 브리지(`probe: mcp`).
 */
export interface ProviderInfo {
  readonly id: string;
  /** ⭐ 오픈코어 경계가 읽는 «단 하나»의 값. */
  readonly needsAccount: boolean;
  /** 어떻게 자격을 대나. ⛔ 값(키)은 여기 «절대» 적지 않는다 — 꼴만 적는다. */
  readonly auth?: 'oauth' | 'api-key' | 'cli-login' | 'none';
  readonly note?: string;
}

/**
 * ⛔ 구현이 쓰는 `provider` 는 «반드시» 여기 있어야 한다 — 시험이 그것을 문다.
 *   ⛔ 여기 없는 provider 가 생기면 경계 계산에서 조용히 「계정 불필요」로 샌다.
 */
export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'local-mlx', needsAccount: false, auth: 'none',
    note: 'media 호스트(ssh-hosts.json `roles: ["media"]`)의 MLX 런타임 — ssh 로 부른다. 계정이 «없다»' },
  { id: 'local-ggml', needsAccount: false, auth: 'none',
    note: '내 기계의 ggml/cpp 빌드 — 계정이 «없다»' },
  { id: 'elevenlabs', needsAccount: true, auth: 'api-key',
    note: '음성 합성·복제 — 종량' },
  { id: 'topview', needsAccount: true, auth: 'oauth',
    note: 'MCP(oauth) · 크레딧 · 잔량은 topview_get_credit' },
  { id: 'higgsfield', needsAccount: true, auth: 'cli-login',
    note: '⛔ 클라우드 생성 CLI 다 — 아래 higgsfield-bridge 와 «다른 축»' },
  { id: 'higgsfield-bridge', needsAccount: true, auth: 'oauth',
    note: '⛔ 로컬 앱(AE·Premiere·Blender)을 모는 «호스팅» 브리지 — '
        + 'tier 는 owned(앱을 샀다)지만 ***브리지가 OAuth 를 탄다***. 둘은 다른 값이다' },
  { id: 'epidemic', needsAccount: true, auth: 'api-key',
    note: '⚠️ resources.yaml 이 EPIDEMIC_SOUND_API_KEY 를 «no reader here» 라 적고 있는데 '
        + '소비자가 «env 변수 독자»가 아니라 MCP 서버라서 못 본 것이다(2026-09-22 실측)' },
];

export interface Impl {
  readonly id: string;
  readonly tier: Tier;
  /** 있는지 재는 법 — PATH 명령 · 파일 경로 · MCP 서버 id. ⛔ 「있다고 치고」 쓰지 않는다.
   *  ⚠️ 이 probe 는 ***낙관적***이다 — 「설치·설정됐나」까지만 답한다.
   *     「지금 쓸 수 있나」는 다른 값이다(골: installed-and-usable-right-now-are-different-values). */
  /**
   * ⛔⭐⭐ 2026-09-22 — `ssh` 갈래를 더했다. 종전 셋은 ***전부 «이 기계»를 전제***했는데,
   *   AX 현장의 실제 모습은 ***「이 노트북엔 없고 사무실 맥스튜디오엔 있다」***이다.
   *   ⇒ 그 사실을 「없다」로 접으면 ***무료로 할 수 있는 일을 유료로 보낸다.***
   *   📌 value 꼴: `<ssh호스트>:<원격 실행 파일 경로>` (예: `node-b:~/mflux-venv/bin/mflux-generate-qwen-2.1`)
   *   ⛔ 붙는 데 실패하면 「없다」가 아니라 ***「못 쟀다」***로 답해야 한다(호스트가 꺼져 있을 수 있다).
   */
  /**
   * ⛔⭐ 2026-09-22 — `http` 갈래를 더했다. ***「앱이 깔려 있나」와 「지금 붙을 수 있나」는 다른 값이다.***
   *   🩸 계기: Affinity 를 `path` 로만 재고 ***「몰 수 없다」고 단정했다*** — 아래 affinity 칸 참고.
   *   📌 value 꼴: `http://localhost:6767/sse` (2xx 면 true · 연결 거부면 false · 그 밖은 «못 쟀다»)
   */
  /**
   * ⛔⭐⭐ 2026-09-23 — `skill` 갈래를 더했다. ***「CLI 가 PATH 에 있나」와 「이 기계가 그것을 쓸 수 있나」는 다른 값이다.***
   *
   * 🩸 계기: 대표 께서 주신 X 링크 둘(영상 편집 스킬 6종 · 프롬프트 라이브러리)을 읽다가 실측했다 —
   *   `hyperframes` 는 `cmd('hyperframes')` 로 재고 있었는데 ***PATH 에 없다.*** 그래서 probe 산출에서
   *   통째로 사라지고, `plan` 이 무료 경로에서 ***이 파일 자신이 "제한적 — 복잡한 타이포는 못 한다"***
   *   고 적어 둔 `ffmpeg-motion` 을 골랐다.
   *   ⛔ 그런데 ***같은 칸의 note 가 이미 "미설치면 npx 로 돈다" 고 적고 있었다.***
   *      📏 실측: `npx hyperframes --version` → `0.8.61` · `~/.claude/skills/hyperframes*` ***8개 모듈***.
   *   🔑 ⇒ ***선언의 note 와 탐침이 서로 다른 말을 하고 있었고, 산출은 탐침 편을 들었다.***
   *
   * 📌 `skill` 의 value 는 `~/.claude/skills/<value>` 의 디렉토리 이름이다(monad 의 스킬 색인과 같은 뿌리).
   * ⛔ 「스킬이 있다」가 「지금 렌더된다」는 아니다 — 그 사실은 note 에 적고, 여기서는 «닿을 수 있나»만 답한다.
   */
  readonly probe: { readonly kind: 'cmd' | 'path' | 'mcp' | 'ssh' | 'http' | 'skill'; readonly value: string };
  /** 과금 단위. free·owned 는 0. */
  readonly unitCost?: string;
  /** ⭐ 과금 «주체». 같은 능력을 두 provider 가 채우면 이 값이 크레딧 정책의 축이 된다. */
  readonly provider?: string;
  /** ⭐ 잔량을 «묻는» 법. ⛔ 없으면 「얼마 남았나」를 못 재고, 못 재면 정책이 감이 된다. */
  readonly quotaProbe?: string;
  /** 무료 할당이 있나 — 있으면 «그것부터» 태운다. */
  readonly hasFreeQuota?: boolean;
  /**
   * ⛔⭐⭐⭐ ***「누가 실행하나」*** — 2026-09-22 신설. ***이 축이 «아예 없었다».***
   *
   * 🩸 계기: 대표 께서 *"affinity 를 이용하여 편집이 가능하지 않을까요?"* 라고 물으셨고,
   *   레지스트리는 `affinity`(tier: owned)를 «있다»고 답하고 있었다. 그런데 실측해 보니:
   * ```
   *   Affinity 3.3.0   NSAppleScriptEnabled 키 «없음» · *.sdef «0건» · CLI «0건»
   *   ⇒ AppleScript·CLI 어느 쪽으로도 ***못 몬다.*** 자동화는 앱 «안»의 매크로/배치잡뿐이고
   *     그것을 밖에서 시작할 길이 없다.
   * ```
   * ⇒ 🔑 ***「살 수 있다」(tier)와 「부를 수 있다」(drive)는 «다른 축»인데 칸이 하나뿐이었다.***
   *   그래서 `client-affinity` 프로파일은 ***사람이 없으면 못 도는 라인을 「된다」고 말한다.***
   *
   * ⚠️ `probe` 와도 다른 축이다 — probe 는 「있나」, drive 는 「내가 부를 수 있나」.
   *   Affinity 는 probe ✅ · drive ⛔ 다. ***둘을 접으면 무인 런이 사람을 기다리다 멎는다.***
   *
   * - `headless`      기본. 명령 한 줄로 부른다(ffmpeg · imagemagick · mflux · audiocpp_cli …)
   * - `app-attached`  로봇이 부를 수는 있는데 ***앱이 «떠 있어야» 한다***(bridge-ae · bridge-premiere)
   * - `gui-only`      ***사람만 쓴다.*** 프로그램 표면이 «없다»
   *   ⚠️ 2026-09-22 정정 — 종전 이 줄은 예시로 `(affinity)` 를 들었는데 ***affinity 는 이제 `app-attached` 다***
   *      (v3.3 의 앱 내장 MCP 를 재고 바꿨다 · 같은 파일 아래 affinity 칸의 「2판」 주석이 그 이력이다).
   *      ⇒ 현재 이 값을 «쓰는 선언은 하나도 없다». 출력 갈래는 `plan` 에 남아 있다(설정으로 들어올 수 있다).
   */
  readonly drive?: 'headless' | 'app-attached' | 'gui-only';
  /**
   * ⛔⭐⭐ ***「이 운영체제에서만 있다」*** — 2026-09-22 신설.
   *
   * 🩸 계기: 🅢 님이 «출시 블로커»를 실측해 보고했다(채널 #16815) —
   *   *"리눅스·WSL 에 PTY 가 «통째로» 없고, doctor 가 ***한 마디도 안 한다***"*.
   *   그 카탈로그 머리말이 이미 이렇게 적고 있었다:
   *   > *"monad reported the absence in four unrelated disguises … None of those name the missing command."*
   *
   * 📏 그 말을 «내 축»에 대고 재 봤다(cloud-vm · Linux 6.17 · 실물):
   * ```
   *   ffmpeg ⛔ · ffprobe ⛔ · sips ⛔ · say ⛔ · magick ⛔ · osascript ⛔
   * ```
   *   ⛔ 그런데 이 레지스트리에 ***플랫폼 칸이 «0개»***였다.
   *   ⇒ 리눅스에서 `sips` 가 없으면 산출은 그냥 「없다」라고 한다 —
   *     ***「macOS 전용이라 이 기계엔 «원리상» 없다」와 「깔면 된다」를 구별할 수 없다.***
   *
   * 🔑 ***부재를 「이름으로」 내야 한다*** — 그것이 🅢 님 골의 문장이고, 같은 병이 여기 있었다.
   */
  readonly platform?: NodeJS.Platform;
  /**
   * ⛔⭐ ***「이 앱이 지금 붙었나」를 «무엇으로» 묻나*** — 2026-09-22 신설.
   *
   * 🩸 계기: `drive: 'app-attached'` 는 ***「앱이 떠 있어야 한다」까지만*** 말하고,
   *   「지금 떠 있나」는 «아무도» 안 물었다. 산출은 13곳에서 *"get_host_status 로 물어라"* 라고
   *   ***사람에게 시켰다*** — 그런데 그 물음은 ***도구가 할 수 있다***(실측:
   *   `monad mcp call higgsfield-bridge.get_host_status` → `{"aeft":true,"ppro":true,"blr":true,…}`).
   *
   * 📌 값은 그 응답의 `structured` 키다(`aeft` · `ppro` · `blr`).
   *   ⛔ 스크립트에 대응표를 «박지 않는다» — 선언이 이름을 준다.
   *   ⛔ 물어서 실패하면 「없다」가 아니라 ***「못 쟀다」***로 답해야 한다.
   */
  /**
   * ⛔⭐⭐ ***「이 기계에서 «돌 만한가»」*** — 2026-09-23 신설.
   *
   * 🩸 계기: 인계(`내부 문서`)가 RAM 바닥 표를 실측해 왔는데
   *   ***이 레지스트리에 그것이 들어갈 칸이 없었다.*** 그래서 `probe` 는 「있다/없다」만 말하고
   *   ***「고객 기계에서 돌겠나」에는 한 마디도 못 했다.*** AX 현장에서 그 물음이 기본값이다.
   *
   * ⛔⭐ 이름이 `minRamGb` 가 «아니라» `minFreeRamGb` 인 이유 — 그 인계가 못 박았다:
   *   > *"「필요 RAM = 보유 RAM」이 아니다. 시스템에서도 쓰고 다른 프로그램도 열려 있으니
   *   >   48기가를 다 쓸 순 없다. ***표는 «여유 메모리» 기준이다.***"*
   *   ⇒ 총량과 견주면 틀린다. 실측 기준은 `vm_stat` 의 free+inactive 다.
   *
   * ⛔ 안 쟀으면 «비워 둔다». 0 이나 추정치를 넣으면 「잰 0」과 「못 쟀다」가 한 칸이 된다.
   * ⛔ 남의 모델의 수를 우리 구현에 «옮겨 붙이지» 않는다 — 예: MiniMax-Video 의 26/44GB 를
   *   `ltx2-mlx`(LTX-2)에 쓰지 않는다. 다른 모델이다.
   */
  readonly minFreeRamGb?: number;
  /** `minFreeRamGb` 가 어디서 왔나. ⛔ 출처 없는 수는 적지 않는다. */
  readonly ramSource?: string;
  readonly hostKey?: string;
  readonly note?: string;
}

export interface Capability {
  readonly id: string;
  readonly what: string;
  readonly impls: readonly Impl[];
}

const cmd = (value: string) => ({ kind: 'cmd' as const, value });
const app = (value: string) => ({ kind: 'path' as const, value });
const mcp = (value: string) => ({ kind: 'mcp' as const, value });
/** ⭐ `~/.claude/skills/<name>` — monad 의 스킬 색인과 «같은 뿌리»다. */
const skill = (value: string) => ({ kind: 'skill' as const, value });

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'asr', what: '말을 글로 (전사)',
    impls: [
      // 🟢 무료 — node-b 의 MLX STT. ⭐ 이 축이 열리면 자막 타이밍을 «받아써서» 맞출 수 있다.
      //   🩸 지금까지는 whisper 모델이 없어 ***「내가 만든 소리를 잰 값」***으로만 정렬했다.
      { id: 'mlx-audio-stt', tier: 'free', provider: 'local-mlx',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/tts-venv/bin/python` },
        note: 'media 호스트 · mlx-audio stt · 크레딧 0' },

      { id: 'whisper-cli', tier: 'free', probe: cmd('whisper-cli'), note: '로컬 · 한국어 가능' },
      { id: 'whisper', tier: 'free', probe: cmd('whisper') },
    ],
  },
  {
    id: 'tts', what: '글을 말로 (나레이션)',
    impls: [
      // 🟢 무료 — node-b 의 MLX Qwen3-TTS. ⭐ `say` 보다 «사람처럼 끊어 읽는다».
      //   📏 2026-09-22 실측(같은 문장): qwen3-tts 8.64s·무음 5구간 ↔ macos-say 5.05s·무음 1구간
      //      mean_volume −17.1dB ↔ −18.2dB (둘 다 «진짜 소리»임을 음량으로 확인)
      //   ⛔ VoiceDesign 판은 `--instruct` 로 ***목소리를 «묘사»***해야 돈다(안 주면 거부한다).
      { id: 'qwen3-tts-mlx', tier: 'free', minFreeRamGb: 8, ramSource: '2026-09-23 인계 실측 §4 (M4 mini 16GB·M4 Pro 48GB·M3 Max 36GB 3대 실연) — Qwen3-TTS 1.7B — 인계가 이 모델을 «이름으로» 댔다', provider: 'local-mlx',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/tts-venv/bin/python` },
        note: 'media 호스트 · mlx-audio · Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit · 크레딧 0' },

      { id: 'elevenlabs', tier: 'metered', probe: cmd('elevenlabs'), unitCost: '문자당', provider: 'elevenlabs',
        note: '⭐ /with-timestamps 로 «만들 때» 자막 타이밍을 같이 받는다 — 되받아 듣지 않는다' },
      { id: 'topview-voice', tier: 'metered', probe: mcp('topview'), unitCost: '크레딧', provider: 'topview',
        quotaProbe: 'topview_get_credit', hasFreeQuota: true,
        note: 'topview_generate_voice · ⭐ 무료 쿼터가 있다(topview_get_mcp_free_quota) — 그것부터 태운다' },
      { id: 'macos-say', tier: 'free', platform: 'darwin', probe: cmd('say'),
        note: '⚠️ 품질이 낮다. 시안·길이 검증용으로는 충분하다 — ***타이밍 구조를 먼저 잡는 데 쓴다***' },
    ],
  },
  {
    id: 'image-gen', what: '이미지 생성',
    impls: [
      // 🟢 무료 — ***다른 기계의*** MLX 로컬 생성(Apple Silicon). 크레딧이 안 든다.
      //   📏 2026-09-22 node-b(M3 Ultra · 512GB)에 `mflux 0.20.0` + `Qwen/Qwen-Image-2.1` 설치.
      //   ⛔ 「무료」는 「빠르다」가 아니다 — 속도는 그 기계에서 «재서» 적는다(아래 note).
      { id: 'qwen-image-mlx', tier: 'free', provider: 'local-mlx',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/mflux-venv/bin/mflux-generate-qwen-2.1` },
        note: 'media 호스트 로컬 MLX · Qwen-Image-2.1 · 크레딧 0 · ⚠️ 그 기계가 꺼져 있으면 「못 쟀다」다' },

      { id: 'higgsfield', tier: 'metered', probe: cmd('higgsfield'), unitCost: '장당 ~10cr',
        provider: 'higgsfield', quotaProbe: 'higgsfield account status',
        note: '⛔ generate cost 견적 ≠ 실제 청구. 실측 델타로 재라' },
      { id: 'topview-image', tier: 'metered', probe: mcp('topview'), unitCost: '크레딧',
        provider: 'topview', quotaProbe: 'topview_get_credit', hasFreeQuota: true,
        note: 'topview_generate_image · ⭐ 힉스필드 크레딧을 아낄 «두 번째 출처»' },
    ],
  },
  {
    id: 'video-gen', what: '영상 생성',
    impls: [
      // 🟢 무료 — node-b 의 MLX 영상 생성(LTX-2). ⛔ ***여기서 이름 하나에 데었다:***
      //   🩸 2026-09-22: PyPI 의 `mlx-video` 는 «영상 전처리 유틸»이고 생성기가 «아니다»
      //      (하위 모듈이 `_io`·`_transforms` 뿐이었다). 이름이 같다고 같은 것이 아니다.
      //   ✅ 진짜는 git 설치다 — `pip install git+https://github.com/Blaizzy/mlx-video.git`
      //      ⇒ `python -m mlx_video.ltx_2.generate`
      { id: 'ltx2-mlx', tier: 'free', provider: 'local-mlx',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/video-venv/bin/python` },
        note: 'media 호스트 · mlx-video(git) · LTX-2 · 크레딧 0 · ⚠️ 모델은 첫 실행에 내려받는다' },

      { id: 'higgsfield-video', tier: 'metered', probe: cmd('higgsfield'), unitCost: '클립당',
        provider: 'higgsfield', quotaProbe: 'higgsfield account status' },
      { id: 'topview-video', tier: 'metered', probe: mcp('topview'), unitCost: '크레딧',
        provider: 'topview', quotaProbe: 'topview_get_credit', hasFreeQuota: true,
        note: 'topview_generate_video' },
    ],
  },
  {
    id: '3d-render', what: '3D 장면 → 프레임',
    impls: [
      { id: 'blender-cli', tier: 'free', probe: cmd('blender'),
        note: '⭐ --background --python 으로 «완전» 스크립트된다. 플러그인 불필요' },
      { id: 'blender-bridge', tier: 'owned', probe: app('/Applications/Blender.app'),
        note: '«사람이 열어 둔 장면» 축 — 무인 배치와 대체재가 아니다' },
    ],
  },
  {
    id: 'motion-graphics', what: '모션 그래픽 · 키네틱 타이포',
    impls: [
      { id: 'hyperframes', tier: 'free', probe: skill('hyperframes'),
        note: 'HTML→비디오. ⛔ CLI 는 PATH 에 «없다» — `npx hyperframes` 로 돈다(판·모듈 수는 `npx hyperframes --version` · `skills check` 로 그때 잰다). '
            + '⭐ 입구 스킬 `/hyperframes` 가 작업 흐름(product-launch-video·motion-graphics …)을 «처음 쓸 때» 설치한다. '
            + '📏 2026-09-23 첫 실물: check·snapshot·render·beats 가 이 기계에서 돌았다(무인은 HYPERFRAMES_SKIP_SKILLS=1·HYPERFRAMES_NO_TELEMETRY=1). '
            + '⚠️ 「스킬이 있다」가 「지금 렌더된다」는 아니다 — 매 호출의 check 결과로 확정하라 (MANUAL-unified-video-production §8c)' },
      { id: 'aerender', tier: 'owned', probe: app('/Applications/Adobe After Effects 2026/aerender'),
        note: '⭐ 자기 인스턴스를 띄워 «열려 있는 AE 세션을 안 건드린다»' },
      { id: 'ffmpeg-motion', tier: 'free', probe: cmd('ffmpeg'),
        note: '⚠️ 제한적 — zoompan·xfade 수준. 복잡한 타이포는 못 한다' },
    ],
  },
  {
    // ⭐⭐ 「Astra 축」의 실물 — 에이전트가 «앱을 도구 호출로» 몬다.
    //   ⛔ 「에이전트가 코드를 쓴다」(ASCII 변환기)와 다르다. 이것은 ***설치 여부를 잴 수 있다***.
    //   📏 실측 2026-09-22: bridge.higgsfield.ai/mcp → 170도구 (pr_* 77 · ae_* 67 · bl_* 25 · get_host_status)
    id: 'app-control', what: '앱을 도구 호출로 몬다 (편집 가능한 프로젝트를 남긴다)',
    impls: [
      { id: 'bridge-ae', tier: 'owned', drive: 'app-attached', provider: 'higgsfield-bridge', hostKey: 'aeft', platform: 'darwin', probe: mcp('higgsfield-bridge'),
        note: 'ae_* 67도구 · ⭐ ae_get_skill 이 «공예 교리» 9종을 들고 있다(ae-clean-rig 를 항상 먼저). '
            + '⛔ 앱이 «떠 있어야» 한다 — get_host_status 로 확인. '
            + '⛔⭐ ***렌더·저장 도구가 «없다»*** — export_frame 뿐. 렌더는 ExtendScript+renderQueue 로 따로 몬다' },
      { id: 'bridge-premiere', tier: 'owned', drive: 'app-attached', provider: 'higgsfield-bridge', hostKey: 'ppro', platform: 'darwin', probe: mcp('higgsfield-bridge'),
        note: 'pr_* 77도구 · ⭐ AE 와 달리 save_project·export_sequence·add_to_render_queue 가 «있다»' },
      // 📏 2026-09-22 실물 검증: bl_render 로 960×540 EEVEE 렌더 성공.
      //   ⛔ 붙이는 데 관문이 «셋»이었다 — 애드온 설치(CEP 와 별개 · .zip 을 창에 드롭)
      //      · Blender 재시작(낡은 프로세스는 애드온을 모른다)
      //      · ⭐ ***사이드바 → Higgsfield → MCP → `Enable MCP control` 체크박스***
      //   🔎 reachable 반증(가장 싸다): lsof -nP -iTCP:9876  ⇒ 0행이면 토글이 꺼진 것이다
      //   ⛔ 벤더 로그의 `action=bridge_connected` 를 «된다»로 읽지 마라 — 그때도 포트는 없었다
      // ⛔⭐ 2026-09-22 — `drive` 가 «비어 있었다». AE·Premiere 는 `app-attached` 인데 Blender 만 빠졌다.
      //   그런데 이 칸의 note 자신이 관문 셋(애드온·재시작·체크)을 적고 있고,
      //   bridge 의 `get_host_status` 도 ***`blr` 을 «호스트»로 답한다***(실측: AE·PR·Blender connected).
      //   ⇒ 빈 칸은 「headless」로 읽힌다 — ***무인 런이 앱 없이 부를 수 있다고 믿는다.***
      { id: 'bridge-blender', tier: 'owned', drive: 'app-attached', provider: 'higgsfield-bridge', hostKey: 'blr', probe: mcp('higgsfield-bridge'),
        note: 'bl_* 25도구 · 검증됨(bl_render). ⛔ 관문 셋: 애드온 · 재시작 · Enable MCP control 체크' },
      { id: 'aerender-jsx', tier: 'owned', probe: app('/Applications/Adobe After Effects 2026/aerender'),
        note: '무인 배치 · 로그인 불필요 · ⛔ Bridge 와 «대체재가 아니다»(사람이 연 세션 ↔ 헤드리스)' },
    ],
  },
  {
    id: 'physics-sim', what: '물리 시뮬레이션 (낙하·충돌)',
    impls: [
      // ⚠️ 도구 스키마가 «낡을 수 있다» — 📏 bl_render 스키마는 BLENDER_EEVEE_NEXT 를 요구했으나
      //    Blender 5.2 의 실제 열거값은 BLENDER_EEVEE 였다(bl_get_scene_summary 가 이미 그렇게 말했다).
      //    ⛔ ***실물이 말해 준 값을 두고 스키마를 믿지 마라.***
      { id: 'blender-physics', tier: 'free', probe: cmd('blender'),
        note: '⭐ rigid body · cloth — `--background --python` 으로 무인 배치 가능. 플러그인 비용 0' },
      { id: 'ae-physics', tier: 'owned', probe: app('/Applications/Adobe After Effects 2026/aerender'),
        note: '⚠️ 서드파티 플러그인이 필요한 경우가 많다 — 그것이 «돈이 드는» 자리다' },
    ],
  },
  {
    id: 'character-rig', what: '캐릭터 리깅 · 애니메이션',
    impls: [
      { id: 'blender-rig', tier: 'free', probe: cmd('blender'), note: 'armature · IK' },
      { id: 'ae-puppet', tier: 'owned', probe: app('/Applications/Adobe After Effects 2026/aerender'),
        note: 'puppet pin — 2D 일러스트에 적합' },
      { id: 'topview-avatar-rig', tier: 'metered', probe: mcp('topview'), provider: 'topview',
        quotaProbe: 'topview_get_credit', note: '인물 한정 — 일러스트 캐릭터는 못 한다' },
    ],
  },
  // ⛔⭐ 「ASCII 변환기를 에이전트가 «만든다»」는 ***능력이 아니다***.
  //    그것은 도구를 «고르는» 일이 아니라 에이전트가 «코드를 쓰는» 일이다.
  //    ⇒ 레지스트리에 넣으면 「설치 여부를 재는」 이 모델이 무의미해진다. 스킬 쪽 일이다.
  {
    id: 'raster-edit', what: '이미지 보정 · 합성',
    impls: [
      { id: 'imagemagick', tier: 'free', probe: cmd('magick') },
      { id: 'sips', tier: 'free', platform: 'darwin', probe: cmd('sips'), note: 'macOS 내장 · 변환/리사이즈만' },
      // 🩸🩸 2026-09-22 — ***이 칸에서 내가 「없다」를 두 번 틀렸다.*** 그 자리를 남긴다.
      //
      //   1판: probe 를 `path` 로만 두고 *"AX 현장에서 가장 현실적인 유료 칸"* 이라고만 적었다.
      //   2판: 대표 께서 *"affinity 로 편집이 가능하지 않을까요"* 라 물으셔서 «재 보고» 이렇게 썼다 —
      //        *"스크립트 표면이 0 · 사람만 쓴다 · 무인 라인에서는 고르지 않는다"* (`drive: 'gui-only'`)
      //   ⛔ ***2판이 거짓이다.*** 대표 께서 *"기존에 벡터 그리기부터 다 되는데요?"* 라고 바로잡으셨다.
      //
      //   📏 내가 «잰» 것: NSAppleScriptEnabled · *.sdef · CLI ⇒ 셋 다 0건 (이 셋은 «사실»이다)
      //   📏 내가 «안 본» 것: ***앱이 품은 MCP 서버*** — Affinity 3.3 은 localhost:6767 에서 SSE 로 듣는다.
      // ```
      //   lsof -nP -iTCP:6767 -sTCP:LISTEN  ⇒ Affinity … TCP [::1]:6767 (LISTEN)
      //   curl -o/dev/null -w'%{http_code}' http://localhost:6767/sse  ⇒ 200
      //   도구 11개 — execute_script(임의 JS) · render_spread · search_sdk_hints …
      // ```
      //   ⇒ ***벡터 드로잉·오프셋 패스·블렌드·PDF 왕복까지 전부 «밖에서» 몰린다.***
      //
      // 🔑 ***「세 표면에 없다」를 「표면이 없다」로 읽었다.*** 부재 판정은 «전수»로만 해야 한다.
      // 🔑 그리고 ***저장소에 이미 매뉴얼이 있었다*** — `MANUAL-affinity-mcp-automation-2026-09-20.md`
      //    (이틀 전 · 실물 드라이버 `aff.py` ⊕ 예제 14편까지 딸린). ***나는 그것을 안 찾고 재기부터 했다.***
      //    ⇒ ⛔ 「없다」고 쓰기 «전»에 ***이 저장소가 이미 답을 갖고 있나***를 먼저 묻는다.
      //
      // ⚠️ `app-attached` 인 이유: MCP 서버가 «앱 안»에 산다 ⇒ 앱이 꺼져 있으면 못 부른다(사람이 못 하는 건 아니다).
      { id: 'affinity', tier: 'owned', drive: 'app-attached',
        // ⛔ 경로가 아니라 ***「지금 붙을 수 있나」***를 잰다 — 앱이 꺼져 있으면 깔려 있어도 못 부른다.
        platform: 'darwin', probe: { kind: 'http', value: 'http://localhost:6767/sse' },
        note: '⭐ 구독이 아니라 «한 번 사는» 앱 — AX 현장에서 가장 현실적인 유료 칸. '
            + '✅ v3.3 부터 ***앱 내장 MCP(localhost:6767·SSE)로 «밖에서» 몬다*** — '
            + 'execute_script 로 벡터·텍스트·블렌드·오프셋패스·PDF 왕복까지. '
            + '⛔ 앱이 «떠 있어야» 하고 권한 토글이 «여덟 칸»이다 ⇒ MANUAL-affinity-mcp-automation-2026-09-20' },
    ],
  },
  {
    id: 'assemble', what: '클립 배치 (편집)',
    impls: [
      { id: 'ffmpeg-edl', tier: 'free', probe: cmd('ffmpeg'),
        note: '⭐ concat·overlay·xfade 로 «전 구간» 가능. 사람이 앱을 안 열어도 된다' },
      { id: 'resolve', tier: 'owned', platform: 'darwin', probe: app('/Applications/DaVinci Resolve/DaVinci Resolve.app'),
        note: '⛔ 스크립팅이 «조용히» 멈춘 실측 있음 → app-silent' },
      { id: 'premiere', tier: 'owned', platform: 'darwin', probe: app('/Applications/Adobe Premiere Pro 2026') },
      { id: 'fcp', tier: 'owned', platform: 'darwin', probe: app('/Applications/Final Cut Pro.app') },
      // ⭐⭐ 클라우드 조립 — ***로컬 앱도 CPU도 없이*** 조립한다(도구 41개: 노드·타임라인·배치·다운로드).
      //   ⛔ 별도 «능력»으로 두면 안 된다 — 이것은 assemble 의 «구현»이다.
      //      그래야 ffmpeg 가 없는 고객 기계에서 ***자동으로 탈출구가 된다***.
      { id: 'topview-canvas', tier: 'metered', probe: mcp('topview'), provider: 'topview',
        quotaProbe: 'topview_get_credit', unitCost: '크레딧',
        note: 'topview canvas — 로컬 도구가 하나도 없을 때의 조립 경로' },
    ],
  },
  {
    id: 'caption', what: '자막 그리기',
    impls: [
      { id: 'ffmpeg-ass', tier: 'free', probe: cmd('ffmpeg'), note: 'subtitles/ass · drawtext' },
      { id: 'aerender-caption', tier: 'owned', platform: 'darwin', probe: app('/Applications/Adobe After Effects 2026/aerender') },
      // 📏 근거: create_topview_canvas_text_node (인가 도구 목록 실측 2026-09-22)
      { id: 'topview-text', tier: 'metered', probe: mcp('topview'), provider: 'topview',
        quotaProbe: 'topview_get_credit', unitCost: '크레딧', note: 'canvas text node' },
    ],
  },
  {
    id: 'color-grade', what: '색 보정',
    impls: [
      { id: 'ffmpeg-lut', tier: 'free', probe: cmd('ffmpeg'), note: 'LUT 적용 수준' },
      { id: 'resolve-grade', tier: 'owned', platform: 'darwin', probe: app('/Applications/DaVinci Resolve/DaVinci Resolve.app'),
        note: '⭐ 이 능력만큼은 유료가 «질적으로» 앞선다' },
    ],
  },
  {
    id: 'audio-mix', what: '오디오 믹스 · 더킹',
    impls: [
      { id: 'ffmpeg-audio', tier: 'free', probe: cmd('ffmpeg'), note: 'sidechaincompress · dynaudnorm' },
      { id: 'sox', tier: 'free', probe: cmd('sox') },
    ],
  },
  {
    id: 'encode', what: '최종 인코딩',
    impls: [
      { id: 'ffmpeg-encode', tier: 'free', probe: cmd('ffmpeg') },
      { id: 'media-encoder', tier: 'owned', platform: 'darwin', probe: app('/Applications/Adobe Media Encoder 2026') },
      // 📏 근거: download_topview_canvas_nodes — 클라우드에서 구워 받는다
      { id: 'topview-export', tier: 'metered', probe: mcp('topview'), provider: 'topview',
        quotaProbe: 'topview_get_credit', unitCost: '크레딧', note: 'canvas 내보내기' },
    ],
  },
  {
    id: 'music-gen', what: '배경음악 생성',
    impls: [
      // 🟢 무료 — node-b 의 MLX 음악 생성(caption + 구조화 가사).
      { id: 'minimax-music3-mlx', tier: 'free', provider: 'local-mlx',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/tts-venv/bin/python` },
        note: 'media 호스트 · mlx-audio music · MiniMax-Music3-4bit · 크레딧 0' },
      // 🟢 무료 — ⛔ 이쪽은 MLX 가 «아니라» GGML 이다(Metal 백엔드).
      //   ⇒ 「무료 구현」이 «한 런타임»에만 있다고 가정하지 않는다.
      //
      // 🩸 2026-09-22 정정 — 종전 이 자리에 `yue2-acestep` 한 칸이 있었고 «둘 다 틀렸다»:
      //   ⓐ 엔진: acestep.cpp 최신 master(68d0ab5·2026-09-21)에 YuE2 지원은 **0건**이다.
      //      (반증: ssh node-b 'cd ~/acestep.cpp && git grep -il yue' ⇒ 내가 쓴 fetch 스크립트뿐)
      //      YuE2 GGUF(audio-cpp/Yue2-3B-GGUF)는 «다른 엔진» audio.cpp 의 `audiocpp_cli` 용이다.
      //   ⓑ 런타임: *"YuE2 의 MLX 판은 없다"* 도 거짓 — `ahmadw/YuE2-3B-MLX`(2026-09-11)가 있다.
      //      내 1차 검색이 GGUF 키워드에 갇혀 있었다. ⇒ ***「못 찾았다」를 「없다」로 접지 않는다.***
      //   ⇒ 그래서 «한 칸»이 아니라 «엔진마다 한 칸»으로 쪼갠다.

      // ✅ 실측 2026-09-22: ace-lm 17초 → ace-synth 4초 ⇒ 19.2s/48k/stereo · mean −18.7dB
      { id: 'acestep-cpp', tier: 'free', minFreeRamGb: 9, ramSource: '2026-09-23 인계 실측 §4 (M4 mini 16GB·M4 Pro 48GB·M3 Max 36GB 3대 실연) — ACE-Step 계열 하위 — 인계가 이 계열을 «이름으로» 댔다', provider: 'local-ggml',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/acestep.cpp/build/ace-synth` },
        note: 'media 호스트 · acestep.cpp(GGML·Metal) · ACE-Step-1.5 Q8 · 크레딧 0 · ⭐ 실측 완료' },
      { id: 'yue2-audiocpp', tier: 'free', provider: 'local-ggml',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:audiocpp_cli` },
        note: 'media 호스트 · audio.cpp(0xShug0) · Yue2-3B-Q8 + vae-f16 · 크레딧 0' },

      { id: 'topview-music', tier: 'metered', probe: mcp('topview'), unitCost: '크레딧',
        provider: 'topview', quotaProbe: 'topview_get_credit', hasFreeQuota: true,
        note: 'topview_generate_music · ⛔ 종전 레지스트리에 이 능력이 «아예 없었다»' },
      { id: 'epidemic-mcp', tier: 'metered', probe: mcp('epidemic'), unitCost: '구독',
        provider: 'epidemic', note: '⭐ 생성이 아니라 «조달» — 라이선스가 명확하다' },
    ],
  },
  {
    id: 'voice-clone', what: '목소리 복제',
    impls: [
      // 🟢 무료 — node-b 의 `tts` 와 «같은 venv, 다른 모델»(VoiceDesign 이 아니라 `Base`).
      //   🔑 `tts` 와 가르는 축: tts 는 목소리를 «묘사»하고(`--instruct`), 이쪽은 ***기준 음성을 «준다»***(`--ref_audio`+`--ref_text`).
      //   📏 2026-09-23 실측: 두 플래그가 `--help` 에 있다 ⊕ 산출 `/tmp/clone_000.wav` 207,404 B ⊕
      //     모델 `Qwen3-TTS-12Hz-1.7B-Base-8bit` 캐시 **5.8GB**(⛔ `du -shL` — `-L` 없이 재면 HF blob 공유로 «작게» 나온다).
      //   ⛔ 🔲 ***`minFreeRamGb` 를 안 쟀다*** — 인계의 8GB 는 VoiceDesign 판 수치이고 이것은 «다른 모델»이다.
      //     같은 1.7B 계열이라는 이유로 옮겨 적지 않는다(이 파일의 `ramSource` 규율 그대로).
      //   ⚠️ probe 경로 — node-b 의 «시스템» `python3` 에는 `mlx_audio` 가 ***없다***. 전용 venv 에만 있다.
      //     (`python3 -m` 으로 물었다가 「없다」로 오판했다. `~/.profile` 이 없는 파일을 source 해 로그인 셸이
      //      매번 에러를 내는 것도 그 오판을 거들었다 — node-b 환경 결함.)
      { id: 'qwen3-tts-clone-mlx', tier: 'free', provider: 'local-mlx',
        probe: { kind: 'ssh', value: `${MEDIA_HOST}:~/tts-venv/bin/python` },
        note: 'media 호스트 · ~/tts-venv · Qwen3-TTS-12Hz-1.7B-***Base***-8bit · `--ref_audio`+`--ref_text` · 크레딧 0' },
      { id: 'topview-clone', tier: 'metered', probe: mcp('topview'), provider: 'topview',
        quotaProbe: 'topview_get_credit', note: 'topview_clone_voice' },
      { id: 'elevenlabs-clone', tier: 'metered', probe: cmd('elevenlabs'), provider: 'elevenlabs' },
    ],
  },
  {
    id: 'avatar-video', what: '아바타·UGC 인물 영상',
    impls: [
      { id: 'topview-avatar', tier: 'metered', probe: mcp('topview'), provider: 'topview',
        quotaProbe: 'topview_get_credit', hasFreeQuota: true,
        note: '⭐ topview_avatar_video · topview_product_avatar — ***힉스필드에 없는 능력***' },
    ],
  },
  {
    id: 'fetch-source', what: '외부 소재 받기',
    impls: [
      { id: 'yt-dlp', tier: 'free', probe: cmd('yt-dlp') },
    ],
  },
];

