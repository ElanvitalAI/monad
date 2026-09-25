// ── DaemonSessionHistory → on-disk SessionStore write-through (R3 · 2026-07-09)
//
// 대표 지시: 백엔드 세션 공유. PWA 챗(ACP 세션 monad-session-N)은 in-memory
// DaemonSessionHistory 에만 살아 목록에 안 뜨고 이동/재시작 시 소실됐다. onAppend
// seam(Tier 1 fan-out)으로 매 턴 메시지를 on-disk SessionStore(~/.monad/sessions)에
// 미러 → 목록/복원/공유 일원화. 텔레그램/CLI(uuid·이미 on-disk)는 제외(중복·루프
// 방지). 설계: 내부 문서 `DESIGN-live-session-management-2026-07-09` §R3.

import type { DaemonSessionHistory } from '../../boot/daemon-runtime.js';
import {
  collectToolUseById,
  persistMessageContent,
  toolTraceFieldsFromContent,
  type SerializedMessage,
} from '../../session/index.js';
import { defaultSessionStore, SessionStore } from '../../session/session-store.js';
import type { LLMMessage } from '../../llm.js';
import { debug } from '../../debug/log.js';

/** ACP/데몬 민팅 세션 판별(신규 세션 origin 라벨용). */
export function isAcpChatSession(id: string): boolean {
  return id.startsWith('monad-session') || id.startsWith('http-');
}

/** on-disk SessionStore → LLMMessage[] read-through(R5 · 완전 무결 공유).
 *  DaemonSessionHistory.get() 이 메모리에 없는 세션을 이걸로 로드 → PWA 챗이
 *  텔레그램/CLI/이전 세션을 열면 그 context 로 이어감. */
export function makeSessionStoreReadThrough(
  store: SessionStore = defaultSessionStore,
): (id: string) => LLMMessage[] | null {
  return (id: string) => {
    try {
      const loaded = store.load(id);
      if (!loaded || loaded.messages.length === 0) return null;
      return loaded.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .map((m) => ({ role: m.role as LLMMessage['role'], content: m.content }));
    } catch {
      return null;
    }
  };
}

/** LLMMessage.content(string | ContentBlock[]) → 저장용 문자열. */
function contentToString(c: LLMMessage['content']): string {
  return persistMessageContent(c);
}

/** DaemonSessionHistory(PWA 챗) → on-disk SessionStore write-through.
 *  onAppend 로 매 턴 메시지를 미러. 반환: 해제 함수. */
export function wireDaemonHistoryToStore(
  history: Pick<DaemonSessionHistory, 'onAppend' | 'getOrigin'>,
  store: SessionStore = defaultSessionStore,
  nowIso: () => string = () => new Date().toISOString(),
): () => void {
  return history.onAppend((sessionId, msgs) => {
    // R5 — 모든 DaemonSessionHistory append 를 on-disk 로 write-through(완전 무결
    // 공유). 데몬에서 DaemonSessionHistory 를 쓰는 건 ACP 챗뿐이라 텔레그램 직접
    // on-disk write 와 이중기록 없음(루프 없음·검증됨). appendById 는 없으면 adopt.
    // 신규 세션 origin: DaemonSessionHistory 에 명시 태깅된 origin(setOrigin) 우선,
    // 없으면 ACP 세션 휴리스틱(pwa). GN (2026-07-18) — 네이티브 앱은 onPromptReceived
    // 에서 _meta.origin.surface='native' 로 setOrigin → 여기서 'native' 전파. 종전
    // 하드코딩 'pwa' 는 iOS 네이티브를 PWA 로 오라벨했다. 기존(uuid)은 adopt no-op 로 보존.
    const tagged = history.getOrigin(sessionId);
    const origin = tagged ?? (isAcpChatSession(sessionId) ? 'pwa' : undefined);
    // Only origins with an equivalent persisted SessionSource declare source.
    // Other tagged or untagged sessions retain origin without guessing a surface.
    const source = origin === 'native' || origin === 'pwa' ? origin : undefined;
    const newSession = source ? { source, origin } : origin ? { origin } : {};
    try {
      // Tool name/args/result are still structured on the original LLMMessage
      // content blocks at this onAppend seam (daemon-history-helper forwards
      // them; DaemonSessionHistory.append fans the same objects out). Copy the
      // fields; never recover them by parsing the flattened content string.
      const toolUseById = collectToolUseById(msgs);
      for (const m of msgs) {
        const content = contentToString(m.content);
        if (!content) continue;
        const persisted: SerializedMessage = { role: m.role, content, ts: nowIso() };
        const trace = toolTraceFieldsFromContent(m.content, toolUseById);
        if (trace) Object.assign(persisted, trace);
        store.appendById(sessionId, persisted, newSession);
      }
    } catch (err) {
      // best-effort — 미러 실패가 라이브 턴을 깨지 않는다. 다만 **조용히** 삼키면
      // 관측 장치의 고장 자체를 관측할 수 없다: 2026-07-23 의 ACP 대화가 통째로
      // 사라졌는데 로그가 한 줄도 없어 사고 조사가 불가능했다(제1원칙 위반).
      debug.log('session.mirror', 'append-failed', {
        sessionId,
        count: msgs.length,
        error: err instanceof Error ? err.message : String(err),
      }, { level: 'error' });
    }
  });
}
