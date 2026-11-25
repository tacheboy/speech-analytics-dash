import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native binaries and server-only libraries load from node_modules at runtime instead of being bundled
  serverExternalPackages: ["pg-boss", "ffmpeg-static", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
