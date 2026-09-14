import Link from 'next/link';

/** The green band at the top of every page, signed in or not. */
export function Masthead({ children }: { children?: React.ReactNode }) {
  return (
    <header className="masthead">
      <div className="shell masthead-row">
        <Link className="wordmark" href="/">
          <span className="wordmark-mark" aria-hidden="true">
            PL
          </span>
          <span>
            Plateau Citizen Portal
            <span className="visually-hidden"> — Government of Plateau State</span>
          </span>
        </Link>
        {children}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site">
      <div className="shell stack">
        <p>
          Government of Plateau State. This portal shows your own record only. Every time a
          government officer looks at it, that is recorded and you can see it under{' '}
          <Link href="/access-history">Who has seen my record</Link>.
        </p>
        <p className="small">
          If something here is wrong, ask for a correction. If you do not recognise an access,
          report it — the record of it cannot be altered or deleted by anyone.
        </p>
      </div>
    </footer>
  );
}

export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {lead === undefined ? null : <p>{lead}</p>}
    </div>
  );
}
