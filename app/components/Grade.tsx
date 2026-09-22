"use client";

/** 채점 표시. 맞으면 동그라미, 틀리면 사선 — 빨간 펜으로 그어지듯 나타난다. */
export function Grade({ ok, animate = true }: { ok: boolean; animate?: boolean }) {
  return (
    <svg
      className={`grade${animate ? " grade--draw" : ""}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      {ok ? (
        <circle cx="16" cy="16" r="11" />
      ) : (
        <path d="M7 25 L25 7" />
      )}
    </svg>
  );
}
