import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg is a server-only DB driver — keep it external from the bundler.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
