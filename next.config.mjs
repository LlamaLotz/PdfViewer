/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Resolve canvas and encoding package dependencies on the server side
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

export default nextConfig;