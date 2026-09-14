import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PCID for security agencies',
    template: '%s · PCID for security agencies',
  },
  description:
    'The Plateau Citizen Identity platform for authorised government officers: verify an identity, ' +
    'open a record under a stated purpose, and work the queues your role is responsible for.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#5c1f2b' },
    { media: '(prefers-color-scheme: dark)', color: '#3f141d' },
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
