import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PCID for emergency response',
    template: '%s · PCID emergency response',
  },
  description:
    'The Plateau Citizen Identity platform for emergency control rooms and crews: take a call, ' +
    'send a unit, and identify somebody at a scene under the incident you are attending.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#9a3b12' },
    { media: '(prefers-color-scheme: dark)', color: '#6a280c' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <a className="skip-link" href="#main">
          Skip to the main content
        </a>
        {children}
      </body>
    </html>
  );
}
