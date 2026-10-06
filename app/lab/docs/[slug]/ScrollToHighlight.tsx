"use client";

import { useEffect } from "react";

/** 근거 카드에서 들어왔을 때 강조된 청크를 화면 가운데로. #앵커만으로는 절 머리로 가서 청크가 화면 밖일 수 있다 */
export function ScrollToHighlight() {
  useEffect(() => {
    document.querySelector('.lab-doc__chunk[data-hl="true"]')?.scrollIntoView({ block: "center" });
  }, []);
  return null;
}
