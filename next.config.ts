import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@motocast/shared-ui"],
  outputFileTracingRoot: process.cwd(),
  experimental: {
    // The CLI checker cannot parse `tsc --showConfig` output reliably in the
    // Windows-mounted WSL workspace. The compiler API performs the same build
    // type-check without skipping diagnostics.
    useTypeScriptCli: false,
  },
  turbopack: {
    root: process.cwd(),
    resolveAlias: { "react-native": "react-native-web" },
    resolveExtensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "react-native$": "react-native-web" };
    config.resolve.extensions = [".web.tsx", ".web.ts", ...config.resolve.extensions];
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
