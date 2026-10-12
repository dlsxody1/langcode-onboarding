/* 서비스 워커 — 지하철처럼 신호가 끊긴 곳에서도 공부 문서와 문제를 열기 위한 캐시.
 *
 * 전략
 *  · 페이지 이동(HTML): 네트워크 우선, 3.5초 안에 못 받거나 오프라인이면 캐시.
 *  · /_next/static · 아이콘 · 폰트: 한 번 받으면 캐시 우선 (파일 이름에 해시가 있어 안전).
 *  · /lab · /api: 로그인이 필요한 경로라 건드리지 않는다.
 *  · 앱이 "precache" 메시지로 전체 페이지 목록을 주면 미리 받아 둔다 (HTML 안의 JS 청크까지).
 *
 * 배포 보호(Vercel Authentication) 뒤에서도 동작해야 한다: 리디렉션·오류 응답은 캐시하지 않는다.
 */
const VERSION = "v1";
const PAGES = `lc-pages-${VERSION}`;
const ASSETS = `lc-assets-${VERSION}`;
const NAV_TIMEOUT_MS = 3500;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, ASSETS]);
      for (const key of await caches.keys()) {
        if (key.startsWith("lc-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

const isCacheable = (res) => res && res.ok && !res.redirected && res.type === "basic";

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function navigate(request) {
  const cache = await caches.open(PAGES);
  const cached = () => cache.match(request, { ignoreSearch: true });

  const network = fetch(request).then((res) => {
    if (isCacheable(res)) cache.put(request, res.clone());
    return res;
  });

  try {
    return await withTimeout(network, NAV_TIMEOUT_MS);
  } catch {
    const hit = await cached();
    if (hit) return hit;
    // 캐시에 없는 페이지: 시간 초과였다면 끝까지 기다려 본다, 오프라인이면 계획 페이지로 대체
    try {
      return await network;
    } catch {
      return (await cache.match("/study")) || new Response("오프라인입니다. 한 번 열어 본 페이지만 볼 수 있습니다.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/lab") || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
    if (request.mode === "navigate") {
      event.respondWith(navigate(request));
    } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
      event.respondWith(cacheFirst(request, ASSETS));
    }
    return; // RSC 데이터 요청 등은 그대로 네트워크로: 실패하면 Next 가 전체 이동으로 바꾸고, 그건 위에서 캐시가 받는다
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, ASSETS));
  }
});

/* ── 미리 받아 두기 ───────────────────────────────────── */
async function precache(urls) {
  const pages = await caches.open(PAGES);
  const assets = await caches.open(ASSETS);
  const chunkUrls = new Set();
  let done = 0;

  async function one(path) {
    try {
      const res = await fetch(path, { credentials: "same-origin" });
      if (!isCacheable(res)) return;
      const html = await res.clone().text();
      for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) chunkUrls.add(m[0]);
      await pages.put(path, res);
      done++;
    } catch {
      /* 한 페이지 실패는 넘긴다 */
    }
  }

  // 동시에 4개씩
  const queue = [...urls];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) await one(queue.shift());
    }),
  );

  const chunks = [...chunkUrls].filter(Boolean);
  const cq = [...chunks];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cq.length) {
        const u = cq.shift();
        try {
          if (await assets.match(u)) continue;
          const res = await fetch(u);
          if (res.ok) await assets.put(u, res);
        } catch {
          /* 무시 */
        }
      }
    }),
  );
  return { pages: done, chunks: chunks.length };
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    precache(data.urls).then(async (result) => {
      const clients = await self.clients.matchAll();
      for (const c of clients) c.postMessage({ type: "precached", ...result });
    }),
  );
});
