import type { NextConfig } from "next";
const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const config: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
  },
};
export default config;
