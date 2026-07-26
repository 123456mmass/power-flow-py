import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async rewrites() {
    const solverBase = process.env.SOLVER_API_BASE?.replace(/\/$/, "");
    if (!solverBase) return [];
    const route = (path: string) => ({ source: `/api/${path}`, destination: `${solverBase}/${path}` });
    return {
      beforeFiles: [
        route("cases"),
        route("health"),
        route("stats"),
        route("runs/:path*"),
        route("presets/:path*"),
        route("audit"),
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
