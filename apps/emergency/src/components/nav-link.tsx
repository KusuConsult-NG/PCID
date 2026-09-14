'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A navigation link that marks itself as the current page for a screen reader. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
