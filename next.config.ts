import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // Raised to accommodate customer document uploads (see MAX_UPLOAD_FILE_SIZE_MB).
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
