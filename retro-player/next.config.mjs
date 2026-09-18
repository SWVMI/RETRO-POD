/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    unoptimized: true,
  },

  serverExternalPackages: ["jsdom"],
};

export default nextConfig;