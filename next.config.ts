import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
