import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@cronoblox/contracts",
    "@cronoblox/db",
    "@cronoblox/config",
    "@cronoblox/engine",
  ],
};

export default nextConfig;
