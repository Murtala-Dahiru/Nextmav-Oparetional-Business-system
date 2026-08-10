import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * ── Why these and not a Content-Security-Policy ───────────────────────────
 *
 * There were none at all before, which is the gap worth closing first: the
 * four below are unconditional wins with no way to break a working page, and
 * three of them address attacks the application is genuinely exposed to —
 * clickjacking against the admin screens, MIME sniffing on uploaded files, and
 * referrer leakage of workspace URLs to third parties.
 *
 * A CSP is deliberately not among them. Next's app router inlines hydration
 * data and framework bootstrap as `<script>` tags, so a useful policy needs
 * per-request nonces threaded through the proxy, and a `script-src` written
 * without them either blocks the application outright or is loosened with
 * `unsafe-inline` to the point of stating nothing. That is a real piece of
 * work rather than a header, and shipping the loosened version would leave a
 * policy that looks like protection and is not.
 */
const SECURITY_HEADERS = [
  /**
   * No framing at all. The whole product is behind a session, and every
   * destructive control in it — suspend, terminate, delete an account,
   * approve an expense — is one click inside an authenticated page. That is
   * precisely what clickjacking is for.
   */
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },

  /**
   * Uploaded files are served from Supabase storage, but avatars and document
   * previews are proxied through this origin. Without this, a file whose
   * declared type says image and whose bytes say HTML is executed as HTML in
   * the session's own origin.
   */
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  /**
   * Workspace URLs carry organization and record identifiers. Sending them to
   * whatever a user clicks through to is a slow leak of the customer's
   * structure to people with no relationship to them.
   */
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /**
   * Nothing here uses the camera, the microphone or geolocation, and an
   * embedded third-party script asking for them should be refused by the
   * browser rather than by the user.
   */
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

const nextConfig: NextConfig = {
  output: "standalone",

  /**
   * Normally `.next`. Overridable so two dev servers can run against this
   * checkout at once.
   *
   * Next 16 takes an exclusive lock on `<distDir>/dev/lock` for the lifetime of
   * `next dev`, in both Turbopack and webpack. The lock is per *directory*, not
   * per port — so a second session running `next dev` here exits immediately
   * with "Unable to acquire lock" however many ports are free, and no amount of
   * `-p` or `autoPort` changes that. Giving the second server its own dist
   * directory gives it its own lock.
   *
   * Unset in every normal path, so `npm run build`, the standalone copy step
   * and CI are all untouched and still read and write `.next`.
   *
   *   NEXT_DIST_DIR=.next-preview npx next dev
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /**
   * Editorial photography on the public surface.
   *
   * Scoped to one host and one path prefix rather than a wildcard: a permissive
   * `remotePatterns` turns the image optimiser into an open proxy that will
   * fetch and re-serve anything a crafted URL points it at, on this origin's
   * reputation and this origin's bandwidth.
   *
   * These images are editorial — they set register and give a section a ground.
   * None of them is presented as a customer, an employee or a testimonial
   * author, which is the line that actually matters; see `EditorialImage`.
   */
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pexels.com', pathname: '/photos/**' },
    ],
  },

  typescript: {
    // Previously true, which let type errors through the build and turned them
    // into runtime failures on the host. The project typechecks cleanly, so
    // failing the build is now the safer default.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      /**
       * Authenticated JSON must never be cached — not by the browser, not by a
       * CDN, and above all not by a shared proxy that could hand one tenant's
       * response to another.
       */
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
        ],
      },
    ];
  },
};

export default nextConfig;
