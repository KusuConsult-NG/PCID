import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Plateau Citizen Portal',
    template: '%s · Plateau Citizen Portal',
  },
  description:
    'See and manage your Plateau Citizen ID, your emergency contacts, and who in government has looked at your record.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1f6b46' },
    { media: '(prefers-color-scheme: dark)', color: '#12171f' },
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
