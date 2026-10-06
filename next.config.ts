import type { NextConfig } from "next";

const config: NextConfig = {
  // 실습 3 검색 색인. 코드에서 import 하지 않고 파일로 읽으므로, 배포 번들에 넣으라고 알려 준다
  outputFileTracingIncludes: {
    "/api/lab/chat": ["./labs/lab3-rag/generated/index.json"],
  },
  // 검색엔진 노출 차단 — 특정 회사 입사 준비 자료다
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default config;
