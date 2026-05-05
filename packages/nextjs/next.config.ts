import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@polypay-zama/shared"],
  typescript: {
    // Hackathon scope: legacy components/hooks left from the polypay strip are
    // not type-safe; we only build the demo page tree.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: config => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.ignoreWarnings = [{ module: /node_modules\/web-worker/ }];
    return config;
  },
};

module.exports = nextConfig;
