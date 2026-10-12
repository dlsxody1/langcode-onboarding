"use client";

import { useEffect } from "react";

const KEY = "lc-precache-v1";
const REFRESH_MS = 12 * 60 * 60 * 1000;

/**
 * 서비스 워커를 등록하고, 전체 페이지를 오프라인용으로 미리 받아 두게 시킨다.
 * 개발 서버에서는 켜지 않는다 — 캐시가 HMR 과 섞이면 디버깅이 어려워진다.
 */
export function PwaRegister({ urls }: { urls: string[] }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    const start = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;

        // 데이터 절약 모드이거나 방금 받았다면 건너뛴다
        const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
        let last = 0;
        try {
          last = Number(window.localStorage.getItem(KEY) ?? 0);
        } catch {
          /* 저장소를 못 쓰는 환경 */
        }
        if (conn?.saveData || Date.now() - last < REFRESH_MS) return;

        reg.active?.postMessage({ type: "precache", urls });
        try {
          window.localStorage.setItem(KEY, String(Date.now()));
        } catch {
          /* 무시 */
        }
      } catch {
        /* 등록 실패해도 사이트는 평소처럼 동작한다 */
      }
    };

    // 첫 화면 로딩과 경쟁하지 않게 로드가 끝난 뒤 한가할 때
    const run = () => ("requestIdleCallback" in window ? window.requestIdleCallback(start) : setTimeout(start, 2000));
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });

    return () => {
      cancelled = true;
    };
  }, [urls]);

  return null;
}
