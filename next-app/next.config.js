/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/app",
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
  images: {
    unoptimized: true
  }
};

module.exports = nextConfig;
