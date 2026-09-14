import Link from 'next/link';

/**
 * The band at the top of every page.
 *
 * A fourth colour, for the fourth audience. Someone glancing at a screen in a
 * control room should be able to tell at once which of the four applications is
 * open, because a counter clerk, an investigator and an ambulance crew reach the
 * same register through very different doors.
 */
export function Masthead({ children }: { children?: React.ReactNode }) {
  return (
    <header className="masthead masthead-emergency">
      <div className="shell masthead-row">
        <Link className="wordmark" href="/">
          <span className="wordmark-mark" aria-hidden="true">
            PL
          </span>
          <span>
            PCID for emergency response
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
          Everything you open is written down: your name, your agency, the incident you named, and
          the fields released to you. The person whose record it is can see that entry, and it
          cannot be altered or deleted by anyone, including you.
        </p>
        <p className="small">
          You receive what emergency care needs and nothing else. If you find yourself wanting more
          than that, the answer is almost never this screen — ask control.
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
