import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verify production builds without replacing a running dev server's output.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  transpilePackages: [
    "@cronoblox/contracts",
    "@cronoblox/db",
    "@cronoblox/config",
    "@cronoblox/engine",
    "@cronoblox/mcp",
    "@cronoblox/agent-tools",
    "@cronoblox/module-roblox-data",
    "@cronoblox/evidence",
    "@cronoblox/source-roblox",
    "@cronoblox/source-youtube",
    "@cronoblox/source-webpage",
  ],
  outputFileTracingIncludes: {
    "/mcp": ["./public/integrations/investigate-roblox/SKILL.md"],
    "/api/integrations/download": ["./public/integrations/investigate-roblox/SKILL.md"],
  },
};

export default nextConfig;
