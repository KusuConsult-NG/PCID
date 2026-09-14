import Link from 'next/link';

/**
 * The band at the top of every page.
 *
 * Visibly a different application from the citizen portal - it is not the same
 * audience and should not be mistaken for the same screen - while being the same
 * government, in the same typeface, with the same controls.
 */
export function Masthead({ children }: { children?: React.ReactNode }) {
  return (
    <header className="masthead masthead-government">
      <div className="shell masthead-row">
        <Link className="wordmark" href="/">
          <span className="wordmark-mark" aria-hidden="true">
            PL
          </span>
          <span>
            PCID for government
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
          Every record you open is written down: your name, your agency, the reason you gave, and
          the fields released to you. The person whose record it is can see that entry, and it
          cannot be altered or deleted by anyone, including you.
        </p>
        <p className="small">
          Open a record only for the purpose you have stated. If you are unsure whether you may, you
          probably may not — ask your supervisor, or raise an access request.
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
