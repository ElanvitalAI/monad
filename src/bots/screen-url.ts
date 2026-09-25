/**
 * 🖥️ **봇 «화면»에 채팅에서 닿는 한 줄** — 「이미 있는 주소를 «말할 뿐»」.
 *
 * ⛔⭐ 이 파일이 **안 하는 것**부터 적는다(그것이 이 축의 설계다):
 *   ① 새 전송·새 렌더를 «짓지 않는다» — 화면(noVNC)·경로(tailscale serve)·벽(bot-wall.html)이 «이미» 있다.
 *   ② **VNC 비번을 «싣지 않는다»** — 36차가 그 결정을 이미 내렸고 이유를 `bot-wall.html` 머리말에 적었다(R2):
 *      *「봇 브라우저가 여는 아무 웹페이지가 `ws://127.0.0.1:608N/` 로 웹소켓을 열 수 있다(웹소켓엔 CORS 가 없다).
 *        비번이 없으면 그 페이지가 봇 화면을 «조작»할 수 있다」* ⇒ 비번은 남기고, 벽에서 «한 번» 친다.
 *      ⛔ 그러니 이 주소를 채팅에 흘려도 «조작 권한»이 같이 새지 않는다. 그것이 URL 에 안 싣는 값이다.
 *   ③ 기본이 «보기 전용»이다 — 조작은 `&control=1` 로 사람이 «명시»해야 열린다(벽이 그렇게 짜여 있다).
 *
 * 🧭 **묶임 선언**(`binding-intent`): 이 자는 ***«호스트»에 묶인다*** —
 *    태일넷 피어 목록과 ssh 별칭 해석은 「이 기계에서 무엇이 보이나」이지 「이번 회차」도 「어느 우주」도 아니다.
 *    ⇒ 시간창(`--since`)·우주(`--instance`)·상한(`--limit`)을 «쓰지 않는다». 쓸 자리가 없다.
 *
 * 🔬 재는 법(사람 눈 없이 여기까지):
 *   `curl -s -o /dev/null -w '%{http_code}' "<이 함수가 낸 주소>"`  ⇒ 200 이어야 «닿는다»
 *   ⛔ 그러나 200 은 「벽이 «떴다»」까지만 답한다 — 「화면이 «보인다»」는 사람 눈 한 번이 필요하다.
 */

/** 봇 CDP 포트의 뿌리. `browserPort` 는 화면 번호에서 «파생»된다(seed-bot-personas.sh 머리말). */
export const BOTLAB_CDP_PORT_BASE = 9400;
/**
 * 화면 번호의 허용 범위. ⛔ **지어낸 수가 아니다** — 「몇 개인가」의 «출처»는 한 곳뿐이다:
 *   `scripts/botlab/provision-bot-screens.sh` 의 `BOT_ROSTER`(지금 1~4) ⊕ 화면 0(머신 화면).
 *   `deploy-bot-wall.sh` 가 그 목록 그대로 `tailscale serve --set-path=/botN` 을 편다.
 * ⛔ 그래서 범위 «밖»의 포트로 주소를 지으면 **404 가 나는 주소를 사람에게 준다** — 짓지 않고 사유를 낸다.
 * ⚠️ 이 수는 «늙는다» — 그래서 `test/bot-screen-url.test.ts` 가 ***그 셸 파일을 읽어 대조***한다.
 *   봇을 늘리면 그 시험이 「여기도 늘려라」라고 말한다(사람 기억에 안 맡긴다).
 */
const BOTLAB_SCREEN_MIN = 0;
export const BOTLAB_SCREEN_MAX = 4;

/** 이 자가 페르소나 한 명에게서 읽는 «전부». ⛔ 레지스트리 타입에 묶지 않는다(시험이 리터럴로 준다). */
export interface ScreenPersona {
  readonly personaId: string;
  readonly displayName?: string;
  readonly browserPort?: number;
}

export type ScreenSlot =
  | { readonly kind: 'screen'; readonly personaId: string; readonly label: string; readonly botNumber: number }
  | { readonly kind: 'no-screen'; readonly personaId: string; readonly label: string; readonly why: string };

/** ⛔ 「화면이 없다」와 「번호가 이상하다」를 «다른 문장»으로 낸다 — 처방이 다르다. */
export function screenSlotFor(persona: ScreenPersona): ScreenSlot {
  const label = persona.displayName?.trim() || persona.personaId;
  const port = persona.browserPort;
  if (port === undefined) {
    // ⛔⭐ 「선언하지 «않았다»」까지가 «내가 아는 것»이다. 「화면이 «없다»」는 그 너머다 —
    //    페르소나 파일은 「어느 화면인가」만 말하고 「화면이 실재하나」는 «다른 자»(bot.sh health · 카나리아 cdp)가 답한다.
    //    ⇒ 여기서 「봇이 아니다」로 단정하면 그것이 이 저장소가 종일 고치는 그 병이다.
    return {
      kind: 'no-screen',
      personaId: persona.personaId,
      label,
      why: '이 페르소나가 화면(browserPort)을 «선언하지 않았다» — ⛔ 「화면이 없다」가 아니라 «어느 화면인지 모른다»이다',
    };
  }
  if (!Number.isInteger(port)) {
    return { kind: 'no-screen', personaId: persona.personaId, label, why: `browserPort 가 정수가 «아니다»(받은 값: ${String(port)})` };
  }
  const botNumber = port - BOTLAB_CDP_PORT_BASE;
  if (botNumber < BOTLAB_SCREEN_MIN || botNumber > BOTLAB_SCREEN_MAX) {
    return {
      kind: 'no-screen',
      personaId: persona.personaId,
      label,
      why:
        `browserPort ${port} 이 «펴 놓은 화면»(${BOTLAB_CDP_PORT_BASE + BOTLAB_SCREEN_MIN}~${BOTLAB_CDP_PORT_BASE + BOTLAB_SCREEN_MAX}) 밖이다` +
        ' — 주소를 지으면 404 가 난다. 화면을 늘렸다면 provision-bot-screens.sh 의 BOT_ROSTER 와 이 상한을 «같이» 늘려라',
    };
  }
  // 🩸⭐ 7차 리뷰가 잡았다: `encodeURIComponent` 는 «헛방패»다 —
  //    벽은 `new URLSearchParams(location.search).get('screens')` 로 읽는데 그것이 ***먼저 복호화***한 뒤에
  //    `split(',')` · `split(':')` 를 한다. ⇒ `%2C`·`%3A` 가 그 시점엔 이미 `,`·`:` 다.
  //    ⛔ 그래서 「감싸면 안전하다」가 «거짓»이고, 이 두 글자는 ***거부하는 것 말고 길이 없다***
  //       (벽의 인코딩 계약을 바꾸는 것은 그 파일을 VM 에 다시 심는 «다른 축»이다).
  const breaks = [',', ':'].filter((ch) => persona.personaId.includes(ch));
  if (breaks.length > 0) {
    return {
      kind: 'no-screen',
      personaId: persona.personaId,
      label,
      why: `봇 이름에 벽의 칸 구분자(${breaks.map((ch) => `'${ch}'`).join(' · ')})가 들어 있다 — 감싸도 벽이 «먼저 풀어» 칸이 깨진다`,
    };
  }
  return { kind: 'screen', personaId: persona.personaId, label, botNumber };
}

/** `/screen` 의 인자. ⛔ 「모르는 낱말」을 «조용히 삼키지» 않는다 — 삼키면 오타가 「전부 보기」가 된다. */
export interface ScreenArgs {
  readonly botId?: string;
  readonly shot: boolean;
  readonly unknown: readonly string[];
}

// ⛔⭐ 별칭을 «안» 둔다(1차 리뷰). 맨 `shot` 을 받아 주면 ***`shot` 이라는 이름의 봇을 영영 못 고른다*** —
//    편의 하나가 이름 공간을 «먹는» 꼴이고, 요청된 것은 `--shot` 뿐이었다.
const SHOT_FLAGS = new Set(['--shot']);

/** ⛔ 순수 — 인자 해석에 바깥이 끼지 않는다. */
export function parseScreenArgs(args: readonly string[]): ScreenArgs {
  let botId: string | undefined;
  let shot = false;
  const unknown: string[] = [];
  for (const raw of args) {
    const arg = raw.trim();
    if (!arg) continue;
    if (SHOT_FLAGS.has(arg)) {
      shot = true;
    } else if (arg.startsWith('-')) {
      unknown.push(arg);
    } else if (botId === undefined) {
      botId = arg;
    } else {
      unknown.push(arg);
    }
  }
  return { ...(botId !== undefined ? { botId } : {}), shot, unknown };
}


/** 태일넷 이름 — ⛔ 「없다」와 「못 물었다」를 «다른 값»으로 낸다. */
export type TailnetHost =
  | { readonly kind: 'ok'; readonly host: string; readonly via: string }
  | { readonly kind: 'unmeasured'; readonly why: string };

export interface TailnetPeer {
  readonly dnsName: string;
  readonly ips: readonly string[];
}

/** 바깥 세계를 «두 물음»으로 좁힌다 — 둘 다 「못 물었다」를 null 로 낸다(빈 배열과 «다르다»). */
export interface TailnetProbe {
  /** ssh 별칭 → 실제 주소. `ssh -G <별칭>` 의 `hostname` 줄. */
  readonly sshHostname: (alias: string) => Promise<string | null>;
  /** 이 기계가 보는 태일넷 피어. */
  readonly peers: () => Promise<readonly TailnetPeer[] | null>;
}

/**
 * `tailscale status --json` 의 산출을 피어 목록으로 «푼다». ⛔ 여기서 «두 실패»가 갈린다:
 *   `null`  = 못 물었다(JSON 이 아니거나 status 꼴이 아니다)
 *   `[]`    = 물었는데 «피어가 0» — 그것도 «답»이다(태일넷에 나 혼자다)
 * 🩸 4차 리뷰가 잡았다: 옛 판은 `Peer` 키가 «없으면» null 을 내서 「0개」를 「못 물었다」로 접었다 —
 *    그 둘을 «가르겠다»고 타입에 적어 놓고 정작 파서가 섞고 있었다.
 */
export function parseTailnetPeers(parsed: unknown): TailnetPeer[] | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  // ⛔ 「status 산출인가」를 «따로» 묻는다 — 아무 JSON 이나 「피어 0개」로 통과시키면 그게 거짓 초록이다.
  if (!('Peer' in root) && !('Self' in root) && !('BackendState' in root)) return null;
  const peerMap = root.Peer;
  if (peerMap === null || peerMap === undefined) return [];
  if (typeof peerMap !== 'object' || Array.isArray(peerMap)) return null;
  return Object.values(peerMap as Record<string, unknown>).map((value) => {
    const peer = (value ?? {}) as { DNSName?: unknown; TailscaleIPs?: unknown };
    return {
      dnsName: typeof peer.DNSName === 'string' ? peer.DNSName : '',
      ips: Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs.filter((ip): ip is string => typeof ip === 'string') : [],
    };
  });
}

const trimDot = (value: string): string => value.replace(/\.$/, '');

/**
 * 피어 하나가 「ssh 가 말한 그 기계」인가.
 * 🩸 5차 리뷰가 잡았다: 옛 판은 `ssh -G` 의 `hostname` 을 ***IP 라고 단정***했다.
 *    그런데 그 값은 «정상 설정»에서도 셋 중 하나다 — ⑴태일넷 IP ⑵태일넷 DNS 이름 ⑶별칭 그 자신
 *    (`Host` 항목이 없으면 ssh 는 별칭을 그대로 낸다). ⇒ ***셋 다 물어야 한다.***
 * ⛔ 대소문자·끝 점은 접는다(DNS 는 그 둘을 안 가린다).
 */
function peerMatches(peer: TailnetPeer, target: string): boolean {
  if (peer.ips.includes(target)) return true;
  const dns = trimDot(peer.dnsName).toLowerCase();
  if (!dns) return false;
  const wanted = trimDot(target).toLowerCase();
  return dns === wanted || dns.split('.')[0] === wanted;
}

/**
 * 별칭 → 주소 → 태일넷 이름. ⛔ 도메인을 «박지 않는다» — 세 걸음 다 물어서 얻는다.
 * ⛔ 어느 걸음이 «비었나»를 그대로 사유로 낸다(「닿는 이름이 없다」로 접지 않는다).
 */
export async function resolveTailnetHost(alias: string, probe: TailnetProbe): Promise<TailnetHost> {
  const target = await probe.sshHostname(alias);
  if (!target) return { kind: 'unmeasured', why: `ssh 별칭 '${alias}' 의 주소를 «못 물었다»(ssh -G ${alias})` };
  const peers = await probe.peers();
  if (peers === null) return { kind: 'unmeasured', why: '태일넷 피어 목록을 «못 물었다»(tailscale status --json)' };
  const hit = peers.find((peer) => peerMatches(peer, target));
  if (!hit) {
    return {
      kind: 'unmeasured',
      why: `피어 ${peers.length}개 중 '${target}' 에 해당하는 것이 «없다» — 그 기계가 이 태일넷에 «안 보인다»`,
    };
  }
  const host = trimDot(hit.dnsName);
  if (!host) return { kind: 'unmeasured', why: `'${target}' 의 피어가 DNS 이름을 «안 냈다»` };
  return { kind: 'ok', host, via: `ssh -G ${alias} ⇒ ${target} ⇒ tailscale peer` };
}

/**
 * 벽 주소. ⛔ 포트를 박지 않는다 — `serve` 경로(`/bot<N>`)가 그것을 안다(벽 머리말과 같은 규율).
 * ⛔ 칸이 하나든 넷이든 «같은 문서»다 — 그래서 비번을 한 번만 친다.
 */
/**
 * 화면을 가진 칸만, ***화면 번호 순***으로. ⛔ 레지스트리가 주는 순서는 «아무 뜻이 없다» —
 * 그런데 «첫 칸»이 벽의 경로(`/botN`)를 정하므로 그대로 두면 주소가 회차마다 달라진다.
 */
function screensOf(slots: readonly ScreenSlot[]): readonly Extract<ScreenSlot, { kind: 'screen' }>[] {
  return slots
    .filter((slot): slot is Extract<ScreenSlot, { kind: 'screen' }> => slot.kind === 'screen')
    .slice()
    // ⛔ 화면 번호 «동률»을 남겨 두면 레지스트리 순서가 그대로 새어 주소가 회차마다 달라진다.
    //    「화면 공유를 «허용»한다」고 적은 이상 그 경우도 «결정적»이어야 한다 ⇒ personaId 로 끊는다.
    //    ⛔ `localeCompare` 를 안 쓴다 — 그것은 실행 환경의 locale/ICU 를 «탄다».
    //       「주소가 «같다»」는 계약이므로 비교는 ***환경에 안 묶여야*** 한다.
    //    🩸 4차 리뷰 정정: 이 비교는 «바이트 순서»가 «아니라» ***UTF-16 코드유닛(ordinal) 순서***다.
    //       BMP 안에서는 UTF-8 바이트 순서와 같고, 서로게이트 쌍(U+10000~)에서 «갈린다».
    //       ⇒ 계약은 ***ordinal***이다(그것으로 충분하다 — 필요한 것은 「환경에 안 묶임」이지 「UTF-8」이 아니다).
    .sort((a, b) => a.botNumber - b.botNumber || (a.personaId < b.personaId ? -1 : a.personaId > b.personaId ? 1 : 0));
}

export function buildBotWallUrl(host: string, slots: readonly ScreenSlot[]): string | null {
  const screens = screensOf(slots);
  if (screens.length === 0) return null;
  // ⛔ 구분자(`:`·`,`)는 «그대로» 둔다 — 사람이 채팅에서 «읽는» 주소다. 값만 감싼다.
  const cells = screens.map((slot) => `${encodeURIComponent(slot.personaId)}:bot${slot.botNumber}`).join(',');
  // 정적 파일은 어느 /botN 으로 열든 같은 뿌리에서 온다 — 첫 칸의 경로를 쓴다(벽 머리말).
  return `https://${host}/bot${screens[0].botNumber}/bot-wall.html?screens=${cells}`;
}

const VIEW_ONLY_NOTE = '👁️ 보기 전용 — 조작은 주소 끝에 `&control=1` 을 «사람이» 붙여야 열린다';
const NO_PASSWORD_NOTE = '🔑 VNC 비번은 «싣지 않는다» — 벽에서 한 번 친다(URL 에 두지 않기로 한 결정: bot-wall.html R2)';

/** 태일넷 이름을 못 물었을 때의 답. ⛔ 「화면이 없다」로 «읽히지 않게» 쓴다. */
export function formatUnmeasuredHost(
  host: Extract<TailnetHost, { kind: 'unmeasured' }>,
  alias?: string,
): string {
  // ⛔ 복구 명령에 «쓰지도 않은» 별칭을 적지 않는다 — BOTLAB_HOST 를 바꾼 사람에게 틀린 처방이 된다.
  const check = alias ? `\`tailscale status --json\` · \`ssh -G ${alias}\`` : '`tailscale status --json`';
  return [
    '🖥️ 화면 주소를 «못 만들었다» — ⛔ 「화면이 없다」가 아니라 ***주소를 못 물었다***입니다.',
    `   사유: ${host.why}`,
    `   확인: ${check}`,
  ].join('\n');
}

/** 봇 하나. */
export function formatOneScreen(host: string, slot: ScreenSlot): string {
  if (slot.kind === 'no-screen') {
    return `🖥️ ${slot.label} (${slot.personaId}) — 화면 주소를 «못 짓는다»: ${slot.why}`;
  }
  const url = buildBotWallUrl(host, [slot]);
  return [
    `🖥️ ${slot.label} (${slot.personaId}) — 화면 :${slot.botNumber}`,
    url,
    VIEW_ONLY_NOTE,
    NO_PASSWORD_NOTE,
  ].join('\n');
}

/** 화면을 선언 안 한 봇들 — 이름은 «다» 대고 사유는 «한 번»만. */
function summarizeWithoutScreen(without: readonly Extract<ScreenSlot, { kind: 'no-screen' }>[]): string[] {
  if (without.length === 0) return [];
  const reasons = new Set(without.map((slot) => slot.why));
  const names = without.map((slot) => `${slot.label}(${slot.personaId})`).join(' · ');
  if (reasons.size === 1) {
    return [`⛔ 주소를 «못 지은» 봇 ${without.length}: ${names}`, `   ↳ ${[...reasons][0]}`];
  }
  return without.map((slot) => `⛔ 주소 못 지음 — ${slot.label}(${slot.personaId}): ${slot.why}`);
}

/** 봇 «전부» — 한 벽에 같이 건다. */
export function formatAllScreens(host: string, slots: readonly ScreenSlot[]): string {
  const url = buildBotWallUrl(host, slots);
  const withScreen = screensOf(slots);
  const without = slots.filter((slot): slot is Extract<ScreenSlot, { kind: 'no-screen' }> => slot.kind === 'no-screen');
  if (!url) {
    return [
      '🖥️ 화면을 «선언한» 봇이 하나도 없습니다 — ⛔ 「화면이 없다」가 아니라 «어느 화면인지 아는 봇이 없다»입니다.',
      ...without.map((slot) => `• ${slot.label} (${slot.personaId}) — ${slot.why}`),
    ].join('\n');
  }
  return [
    `🖥️ 봇 화면 ${withScreen.length}개 — 한 벽에서 «같이» 본다(비번 한 번)`,
    url,
    ...withScreen.map((slot) => `• ${slot.label} (${slot.personaId}) — 화면 :${slot.botNumber} · \`/screen ${slot.personaId}\``),
    // ⛔ 사유가 «전부 같은 말»이면 봇마다 되풀이하지 않는다 — 채팅에서 그건 잡음이고,
    //    잡음은 사람이 «안 읽게» 만들어서 결국 정직함을 잃는다. 이름은 다 대되 사유는 한 번만.
    ...summarizeWithoutScreen(without),
    VIEW_ONLY_NOTE,
    NO_PASSWORD_NOTE,
  ].join('\n');
}
