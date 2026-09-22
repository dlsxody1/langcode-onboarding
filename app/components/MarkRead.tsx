"use client";

import { useEffect } from "react";
import { markRead } from "@/lib/progress";

export function MarkRead({ chapterId, docSlug }: { chapterId: string; docSlug: string }) {
  useEffect(() => {
    markRead(chapterId, docSlug);
  }, [chapterId, docSlug]);
  return null;
}
