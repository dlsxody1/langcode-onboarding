"use client";

import { useId, useState } from "react";

/**
 * 힌트. 호버로 열리는 게 기본이지만 호버만으로 만들면 터치와 키보드에서 못 쓴다.
 * 그래서 진짜 버튼으로 두고 hover / focus / click 셋 다 열리게 했다.
 */
export function Hint({ text }: { text: string }) {
  const [pinned, setPinned] = useState(false);
  const id = useId();

  return (
    <span className="hint" data-pinned={pinned || undefined}>
      <button
        type="button"
        className="hint__btn"
        aria-expanded={pinned}
        aria-controls={id}
        onClick={() => setPinned((v) => !v)}
      >
        힌트
      </button>
      <span className="hint__body" id={id} role="note">
        {text}
      </span>
    </span>
  );
}
