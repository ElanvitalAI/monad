import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { debug } from '../debug/log.js';
import { effectiveCodexHome, resolveCodexAccount } from '../oauth/codex-account.js';
import { authStorePath, loadTokens } from '../oauth/store.js';
import { extractChatGPTClaims } from '../oauth/jwt.js';

const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CONSUME_RESET_CREDITS_URL = `${RESET_CREDITS_URL}/consume`;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CodexResetCredit {
  id: string;
  status: string;
  granted_at: string | null;
  expires_at: string | null;
  redeem_started_at: string | null;
  redeemed_at: string | null;
  title: string | null;
  description: string | null;
}

export interface CodexResetCredits {
  credits: CodexResetCredit[];
  availableCount: number;
  totalEarnedCount: number;
}

export interface CodexResetCreditsOpts {
  /** Path to the selected Codex account's auth mirror. */
  readonly authFilePath?: string;
  /** Environment used only to resolve the default mirror path; it is never mutated. */
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam. Production requests use global fetch. */
  readonly fetchImpl?: FetchLike;
  /** Test seam — monad 인증 저장소 경로(Codex 파일을 못 읽을 때 같은 계정 토큰을 여기서 읽는다). */
  readonly authStorePath?: string;
}

export interface ConsumeCodexResetCreditsOpts extends CodexResetCreditsOpts {
  /** Caller-supplied idempotency key. This is never a credit id. */
  readonly redeemRequestId?: string;
}

export type CodexResetCreditsResult =
  | { ok: true; value: CodexResetCredits }
  | { ok: false; kind: 'auth' | 'request' | 'response-shape'; message: string; response?: unknown };

export type ConsumeCodexResetCreditsResult =
  | { ok: true; value: { code: 'reset'; credit: CodexResetCredit }; redeemRequestId: string }
  | { ok: false; kind: 'auth' | 'request' | 'response-shape'; message: string; response?: unknown; redeemRequestId?: string };

interface AuthCredentials {
  accessToken: string;
  accountId?: string;
}

/** Lists the reset credits available to the currently authenticated Codex account. */
export async function listCodexResetCredits(opts: CodexResetCreditsOpts = {}): Promise<CodexResetCreditsResult> {
  const credentials = await loadCredentials(opts.authFilePath, opts.env, opts.authStorePath);
  if (!credentials.ok) {
    log('list-failed', { kind: credentials.kind });
    return credentials;
  }

  try {
    const response = await (opts.fetchImpl ?? fetch)(RESET_CREDITS_URL, {
      method: 'GET',
      headers: requestHeaders(credentials.value),
    });
    const body = await parseBody(response);
    if (!response.ok) {
      const result = requestFailure(response, body);
      log('list-failed', { kind: result.kind, status: response.status });
      return result;
    }
    const value = parseCredits(body);
    if (!value) {
      const result = shapeFailure(body);
      log('list-failed', { kind: result.kind });
      return result;
    }
    log('list-succeeded', { availableCount: value.availableCount, totalEarnedCount: value.totalEarnedCount });
    return { ok: true, value };
  } catch (error) {
    const result = exceptionFailure(error);
    log('list-failed', { kind: result.kind });
    return result;
  }
}

/** Consumes one server-selected available reset credit using an idempotency key. */
export async function consumeCodexResetCredits(
  opts: ConsumeCodexResetCreditsOpts = {},
): Promise<ConsumeCodexResetCreditsResult> {
  const redeemRequestId = opts.redeemRequestId ?? randomUUID();
  const credentials = await loadCredentials(opts.authFilePath, opts.env, opts.authStorePath);
  if (!credentials.ok) {
    log('consume-failed', { kind: credentials.kind });
    return { ...credentials, redeemRequestId };
  }

  try {
    const response = await (opts.fetchImpl ?? fetch)(CONSUME_RESET_CREDITS_URL, {
      method: 'POST',
      headers: requestHeaders(credentials.value),
      body: JSON.stringify({ redeem_request_id: redeemRequestId }),
    });
    const body = await parseBody(response);
    if (!response.ok) {
      const result = requestFailure(response, body);
      log('consume-failed', { kind: result.kind, status: response.status });
      return { ...result, redeemRequestId };
    }
    const value = parseConsume(body);
    if (!value) {
      const result = shapeFailure(body);
      log('consume-failed', { kind: result.kind });
      return { ...result, redeemRequestId };
    }
    log('consume-succeeded', { creditStatus: value.credit.status });
    return { ok: true, value, redeemRequestId };
  } catch (error) {
    const result = exceptionFailure(error);
    log('consume-failed', { kind: result.kind });
    return { ...result, redeemRequestId };
  }
}

async function loadCredentials(
  authFilePath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  storePath?: string,
): Promise<{ ok: true; value: AuthCredentials } | Extract<CodexResetCreditsResult, { ok: false }>> {
  const fromFile = await loadCredentialsFromCodexFile(authFilePath ?? defaultCodexAuthPath(env));
  if (fromFile.ok) return fromFile;
  // 🩸 2026-09-24 빈 VM(🅢 #20263 ④): `monad login openai-codex` 가 id_token 없이 끝나면 Codex CLI 파일 미러를
  //   «안 만든다»(`not-created-missing-cli-fields`) — 로그인은 됐는데 이 칸이 `unavailable (auth)` 였다.
  //   ⇒ 파일을 못 읽으면 «같은 계정»(env 로 해석한 저장 키)의 monad 토큰으로 읽는다. 다른 계정으로 새지 않는다.
  if (authFilePath === undefined) {
    const fromStore = loadCredentialsFromMonadStore(env, storePath);
    if (fromStore) {
      log('auth-from-monad-store', { fileKind: fromFile.kind });
      return fromStore;
    }
  }
  return fromFile;
}

function loadCredentialsFromMonadStore(env: NodeJS.ProcessEnv, storePath: string = authStorePath()): { ok: true; value: AuthCredentials } | null {
  try {
    const account = resolveCodexAccount(env, { storedHome: (key) => loadTokens(key, storePath)?.codexHome });
    const accessToken = loadTokens(account.storeKey, storePath)?.tokens?.accessToken;
    if (typeof accessToken !== 'string' || !accessToken) return null;
    const accountId = extractChatGPTClaims(accessToken)?.accountId;
    return { ok: true, value: { accessToken, ...(accountId ? { accountId } : {}) } };
  } catch {
    return null;
  }
}

async function loadCredentialsFromCodexFile(
  path: string,
): Promise<{ ok: true; value: AuthCredentials } | Extract<CodexResetCreditsResult, { ok: false }>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const tokens = objectValue(parsed)?.tokens;
    const tokenObject = objectValue(tokens);
    const accessToken = tokenObject?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      return { ok: false, kind: 'auth', message: 'Codex auth file has no tokens.access_token' };
    }
    const explicitAccountId = tokenObject.account_id;
    const accountId = typeof explicitAccountId === 'string' && explicitAccountId
      ? explicitAccountId
      : extractChatGPTClaims(accessToken)?.accountId;
    return { ok: true, value: { accessToken, ...(accountId ? { accountId } : {}) } };
  } catch (error) {
    return { ok: false, kind: 'auth', message: `Unable to read Codex auth file: ${errorMessage(error)}` };
  }
}

function defaultCodexAuthPath(env: NodeJS.ProcessEnv): string {
  const storePath = authStorePath();
  const account = resolveCodexAccount(env, { storedHome: (key) => loadTokens(key, storePath)?.codexHome });
  const stored = loadTokens(account.storeKey, storePath);
  const { home = account.home } = effectiveCodexHome(account, stored, env);
  return join(home, 'auth.json');
}

function requestHeaders(credentials: AuthCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    'Content-Type': 'application/json',
    originator: 'Codex Desktop',
    'OAI-Product-Sku': 'CODEX',
    ...(credentials.accountId ? { 'chatgpt-account-id': credentials.accountId } : {}),
  };
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseCredits(body: unknown): CodexResetCredits | null {
  const raw = objectValue(body);
  if (!raw || !Array.isArray(raw.credits) || typeof raw.available_count !== 'number' || typeof raw.total_earned_count !== 'number') return null;
  const credits = raw.credits.map(parseCredit);
  return credits.every((credit): credit is CodexResetCredit => credit !== null)
    ? { credits, availableCount: raw.available_count, totalEarnedCount: raw.total_earned_count }
    : null;
}

function parseConsume(body: unknown): { code: 'reset'; credit: CodexResetCredit } | null {
  const raw = objectValue(body);
  const credit = parseCredit(raw?.credit);
  return raw?.code === 'reset' && credit?.status === 'redeemed' && credit.redeemed_at ? { code: 'reset', credit } : null;
}

function parseCredit(value: unknown): CodexResetCredit | null {
  const raw = objectValue(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.status !== 'string') return null;
  const nullableFields = ['granted_at', 'expires_at', 'redeem_started_at', 'redeemed_at', 'title', 'description'] as const;
  if (!nullableFields.every((field) => raw[field] === null || typeof raw[field] === 'string')) return null;
  return {
    id: raw.id,
    status: raw.status,
    granted_at: raw.granted_at as string | null,
    expires_at: raw.expires_at as string | null,
    redeem_started_at: raw.redeem_started_at as string | null,
    redeemed_at: raw.redeemed_at as string | null,
    title: raw.title as string | null,
    description: raw.description as string | null,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requestFailure(response: Response, body: unknown): Extract<CodexResetCreditsResult, { ok: false }> {
  return { ok: false, kind: 'request', message: `Codex reset credits request failed with HTTP ${response.status}`, response: body };
}

function shapeFailure(response: unknown): Extract<CodexResetCreditsResult, { ok: false }> {
  return { ok: false, kind: 'response-shape', message: 'Codex reset credits response had an unexpected shape', response };
}

function exceptionFailure(error: unknown): Extract<CodexResetCreditsResult, { ok: false }> {
  return { ok: false, kind: 'request', message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(event: string, data: Record<string, unknown>): void {
  debug.log('budget.codex-reset-credits', event, data);
}

// ─── 부여 주기 관측 ──────────────────────────────────────────────────
//
// ⛔⭐⭐ **왜 이것이 필요한가**: 「Pro 는 리셋을 몇 번 받나」는 2026-08-05 현재 «답할 수 없다» —
//   우리 계정 이력에 부여가 «한 건»뿐이라 주기를 관측할 표본이 없다.
//   ⇒ 그래서 매뉴얼(§2c)은 그 칸을 「모른다」로 비워 두고 ***재는 법***만 남겼다:
//     ***`available_count` 의 «0→1 전이»를 기록한다. 전이를 보기 «전엔» 말하지 않는다.***
//   ⚠️ 사용(consume)도 1→0 전이를 만들므로 «부여»와 «소비»를 구분해 적는다.

export type ResetCreditAvailabilityTransition = 'granted' | 'consumed' | 'unchanged' | 'first-observation';

export interface ResetCreditAvailabilityChange {
  readonly transition: ResetCreditAvailabilityTransition;
  readonly from: number | undefined;
  readonly to: number;
  /** 이 전이가 「부여 주기」의 표본이 되는가. ⛔ 첫 관측은 «아니다» — 그 전을 모른다. */
  readonly isGrantSample: boolean;
}

/**
 * ⭐ 순수 핵심 — 저장·네트워크 없이 두 수만 본다. 그래서 이 판정이 시험 가능하다.
 * ⛔ 「이전 값 없음」을 0 으로 «채우지 않는다** — 그러면 첫 관측이 항상 「부여」로 세어진다.
 */
export function classifyResetCreditAvailability(
  previous: number | undefined,
  current: number,
): ResetCreditAvailabilityChange {
  if (previous === undefined) {
    return { transition: 'first-observation', from: undefined, to: current, isGrantSample: false };
  }
  if (current > previous) return { transition: 'granted', from: previous, to: current, isGrantSample: true };
  if (current < previous) return { transition: 'consumed', from: previous, to: current, isGrantSample: false };
  return { transition: 'unchanged', from: previous, to: current, isGrantSample: false };
}

export interface ObserveResetCreditAvailabilityOpts extends CodexResetCreditsOpts {
  /** 직전 관측값을 읽는다. 없으면 undefined — ⛔ 0 으로 대체하지 않는다. */
  readonly readPrevious?: () => number | undefined | Promise<number | undefined>;
  /** 이번 관측값을 남긴다. 실패해도 판정을 막지 않는다(fail-soft). */
  readonly writeCurrent?: (count: number) => void | Promise<void>;
}

export type ObserveResetCreditAvailabilityResult =
  | { ok: true; change: ResetCreditAvailabilityChange }
  | { ok: false; kind: 'auth' | 'request' | 'response-shape'; message: string };

/**
 * 리셋 크레딧 «가용 수»를 한 번 관측하고 직전 값과의 전이를 기록한다.
 * ⛔ 스케줄은 이 함수의 몫이 «아니다** — 언제 부를지는 호출자(사람·크론)가 정한다.
 */
export async function observeResetCreditAvailability(
  opts: ObserveResetCreditAvailabilityOpts = {},
): Promise<ObserveResetCreditAvailabilityResult> {
  const listed = await listCodexResetCredits(opts);
  if (!listed.ok) {
    log('availability-observe-failed', { kind: listed.kind, message: listed.message });
    return { ok: false, kind: listed.kind, message: listed.message };
  }
  let previous: number | undefined;
  try {
    previous = await opts.readPrevious?.();
  } catch {
    previous = undefined;   // 읽기 실패는 「이전을 모른다」와 같다
  }
  const change = classifyResetCreditAvailability(previous, listed.value.availableCount);
  log('availability-observed', { ...change });
  try {
    await opts.writeCurrent?.(listed.value.availableCount);
  } catch (error) {
    log('availability-persist-failed', { message: error instanceof Error ? error.message : String(error) });
  }
  return { ok: true, change };
}
