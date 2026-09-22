import type { NextConfig } from "next";

const config: NextConfig = {
  // 검색엔진 노출 차단 — 특정 회사 입사 준비 자료다
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default config;
