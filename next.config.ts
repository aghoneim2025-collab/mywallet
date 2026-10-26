import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // P0.11: turn OFF ignoreBuildErrors — type errors must fail the build.
  typescript: {
    ignoreBuildErrors: false,
  },
  // P0.11: enable React strict mode (catches unsafe lifecycles, side effects).
  reactStrictMode: true,
  // P0.11: security headers. CSP is intentionally permissive on 'unsafe-inline'
  // for styles because Tailwind generates inline styles; tighten later.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer policy — only send origin to same-origin, no referrer to others
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS — force HTTPS for 2 years (1 year min for HSTS preload list)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Disable dangerous browser features
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Content Security Policy
          // - default-src 'self': only load resources from same origin
          // - script-src 'self' 'unsafe-inline': inline scripts needed by Next.js
          // - style-src 'self' 'unsafe-inline': inline styles needed by Tailwind/Next
          // - img-src 'self' data: blob:: allow data + blob URLs (avatars, charts)
          // - connect-src 'self': only API calls to same origin
          // - font-src 'self' data:: allow embedded fonts
          // - frame-ancestors 'none': equivalent to X-Frame-Options DENY
          // - base-uri 'self': prevent <base> hijacking
          // - form-action 'self': prevent form submission to external sites
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
