"use client";

/**
 * 진도와 오답은 브라우저에만 남는다. 서버도 계정도 없다.
 * 사용자가 한 명이고 기기가 두 대(맥북·윈도우)라 동기화가 안 되지만,
 * 그걸 위해 백엔드를 두는 건 과하다. 기기별로 따로 푸는 걸로 충분하다.
 */

const KEY = "lc-onboarding-v1";

export type Attempt = { qid: string; picked: number; correct: boolean; at: number };
export type Store = { attempts: Record<string, Attempt>; read: Record<string, number> };

const EMPTY: Store = { attempts: {}, read: {} };

export function load(): Store {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { attempts: parsed.attempts ?? {}, read: parsed.read ?? {} };
  } catch {
    return EMPTY;                 // 비공개 창·차단된 저장소에서도 앱은 동작해야 한다
  }
}

function save(s: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 실패는 조용히 넘긴다 — 학습 자체를 막을 이유가 없다 */
  }
}

export function recordAttempt(a: Attempt) {
  const s = load();
  s.attempts[a.qid] = a;
  save(s);
}

export function markRead(chapterId: string, docSlug: string) {
  const s = load();
  s.read[`${chapterId}/${docSlug}`] = Date.now();
  save(s);
}

export function reset() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
