import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@polypay/shared"],
  typescript: {
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

if (process.env.STANDALONE === "true") {
  nextConfig.output = "standalone";
  nextConfig.experimental = {
    // @ts-expect-error - outputFileTracingRoot exists in Next.js 15 but not in type definitions
    outputFileTracingRoot: path.join(__dirname, "../../"),
  };
}

module.exports = nextConfig;
