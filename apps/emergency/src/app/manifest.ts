import type { MetadataRoute } from 'next';

/**
 * The installable responder application (master system prompt §56).
 *
 * A crew works from a phone in a vehicle, and the portal is installed onto the
 * home screen rather than downloaded from a store. That is a deliberate choice
 * and `docs/mobile.md` sets out why: no separate release train, no store review
 * between a fix and the people who need it, no thirty-megabyte download over a
 * metered connection, and the same authentication and the same authorisation as
 * the browser it is built from.
 *
 * `display: standalone` so it opens without browser furniture, and
 * `orientation: portrait` because it is read one-handed beside a stretcher.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PCID Emergency Response',
    short_name: 'PCID Response',
    description:
      'The Plateau Citizen Identity platform for emergency crews: the incident you are on, and ' +
      'the minimum necessary profile of the person in front of you.',
    id: '/home',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#9a3b12',
    lang: 'en-NG',
    categories: ['medical', 'government'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
