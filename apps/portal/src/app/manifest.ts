import type { MetadataRoute } from 'next';

/**
 * The installable citizen application (master system prompt §56).
 *
 * Installed from the portal rather than downloaded from a store, for the reasons
 * set out in `docs/mobile.md` - chief among them that a resident on a metered
 * connection should not have to pay for thirty megabytes to see their own
 * identifier, and that a state should not need a corporate account with two
 * foreign companies to fix a bug in its own identity service.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Plateau Citizen Portal',
    short_name: 'Plateau ID',
    description:
      'Your Plateau Citizen ID, who has looked at your record, and the things only you can change.',
    id: '/dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1f6b46',
    lang: 'en-NG',
    categories: ['government'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
