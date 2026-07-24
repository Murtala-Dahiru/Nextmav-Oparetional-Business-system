import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Previously true, which let type errors through the build and turned them
    // into runtime failures on the host. The project typechecks cleanly, so
    // failing the build is now the safer default.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
