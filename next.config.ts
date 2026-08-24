import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  allowedDevOrigins: ['192.168.0.103', '*.trycloudflare.com'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
