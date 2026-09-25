// ── SessionStore 매니저 (R2 · 2026-07-09) ─────────────────────────────────
//
// 대표 지시: 세션 저장 매니저/래퍼로 백엔드 세션을 일원화. on-disk 저장소
// (~/.monad/sessions · index.json + <id>.jsonl)를 단일 진실원으로 감싸는 클래스.
// 함수형 src/session API 를 OO 로 래핑 + 명시 id write-through(appendById)를 추가해
// PWA 챗(ACP monad-session-N)·텔레그램·CLI 가 모두 같은 저장소를 공유하게 한다(R3).
// object storage 백업은 후속(이 매니저가 삽입 지점).

import {
  sessionRoot,
  listSessions,
  loadSession,
  createSession,
  adoptSession,
  appendMessage,
  forkSessionFromHistory,
  deleteSession,
  type SessionMeta,
  type SerializedMessage,
  type LoadedSession,
  type CreateSessionOpts,
  type ForkSessionOpts,
  type ListSessionsOpts,
} from './index.js';

export class SessionStore {
  /** C4 수리 부수(2026-07-12) — root를 생성 시점에 박제하지 않는다.
   *  명시 root가 없으면 매 콜마다 sessionRoot()를 재평가 — 스토어 함수
   *  규약("env는 콜 타임에 lazy")과 정합. defaultSessionStore 싱글턴이
   *  모듈 로드 이후 설정된 MONAD_STATE_DIR/MONAD_SESSION_ROOT를
   *  무시하던 결함 해소(격리 러너·테스트 combined-run 모두 수혜). */
  constructor(private readonly rootOverride?: string) {}

  private get root(): string {
    return this.rootOverride ?? sessionRoot();
  }

  /** 세션 목록(newest-first). */
  list(opts: ListSessionsOpts = {}): SessionMeta[] {
    return listSessions(opts, this.root);
  }

  /** 단일 세션(meta + transcript). 없으면 null. */
  load(id: string): LoadedSession | null {
    return loadSession(id, this.root);
  }

  /** id 존재 여부(index 기준·경량). */
  has(id: string): boolean {
    return this.list().some((m) => m.id === id);
  }

  /** 신규 세션(uuid 민팅). */
  create(opts: CreateSessionOpts = {}): SessionMeta {
    return createSession(opts, this.root);
  }

  /** 명시 id 채택(멱등) — 데몬 민팅 id 를 on-disk 로 등록. */
  adopt(id: string, opts: CreateSessionOpts = {}): SessionMeta {
    return adoptSession(id, opts, this.root);
  }

  /** 히스토리 복사 새 세션(fork · forkedFromId 링크). */
  fork(opts: ForkSessionOpts): LoadedSession {
    return forkSessionFromHistory(opts, this.root);
  }

  delete(id: string): void {
    deleteSession(id, this.root);
  }

  /** id 로 메시지 append(없으면 adopt) — write-through 통합의 핵심(R3).
   *  meta 는 첫 채택 시 세션 속성(source/origin/title 등). */
  appendById(id: string, msg: SerializedMessage, meta: CreateSessionOpts = {}): SessionMeta {
    this.adopt(id, meta); // 멱등 — 이미 있으면 무변경
    return appendMessage(id, msg, this.root);
  }
}

/** 프로세스 공용 기본 매니저(~/.monad/sessions). */
export const defaultSessionStore = new SessionStore();
