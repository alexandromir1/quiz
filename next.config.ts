import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Compressed quiz images as data URLs in JSON
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
