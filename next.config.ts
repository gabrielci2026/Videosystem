import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita que el overlay de DevTools de Next.js agregue modulos RSC inestables.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
};

export default nextConfig;
