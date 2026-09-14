import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Security agency portal configuration.
 *
 * The same back-end-for-front-end shape as the other two, for the strongest
 * reason of the three: what this application reaches is case-bound access to
 * the register, under a criminal-investigation purpose, by officers holding the
 * law-enforcement compartment. It renders on the server, holds the session, and
 * the browser receives nothing it could replay.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  reactStrictMode: true,
  // The shared kit ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@pcid/portal-kit'],
  poweredByHeader: false,
  // Server-rendered throughout: nothing about a citizen's record is static.
  output: 'standalone',
  // Stated rather than inferred, so the traced dependency set is the same on a
  // developer's machine and in the container build.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  experimental: {
    // Server Actions reject cross-origin submissions, which is the portal's
    // CSRF defence alongside a same-site session cookie.
    serverActions: {
      allowedOrigins: (process.env.SECURITY_PORTAL_ALLOWED_ORIGINS ?? '')
        .split(',')
        .filter(Boolean),
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            // No page here has any business knowing where an officer is.
            value: 'geolocation=(), camera=(), microphone=(), payment=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next's inline bootstrap needs a hash-free allowance; there is no
              // third-party script on any page.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'none'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default config;
