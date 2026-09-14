export type NoticeTone = 'info' | 'ok' | 'warn' | 'danger';

const TONE_CLASS: Record<NoticeTone, string> = {
  info: '',
  ok: 'notice-ok',
  warn: 'notice-warn',
  danger: 'notice-danger',
};

/**
 * A message about what just happened, or what the resident needs to know.
 *
 * Errors and confirmations both render with `role="status"` on a live region so
 * a screen reader announces them after a form submission without the page
 * needing to move focus.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  live = false,
}: {
  tone?: NoticeTone;
  title?: string;
  children: React.ReactNode;
  live?: boolean;
}) {
  return (
    <div
      className={`notice ${TONE_CLASS[tone]}`.trim()}
      {...(live ? { role: 'status', 'aria-live': 'polite' } : {})}
    >
      {title === undefined ? null : <h3>{title}</h3>}
      {typeof children === 'string' ? <p>{children}</p> : children}
    </div>
  );
}

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'info' | 'muted';
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * A field the platform declined to release, shown rather than omitted (§29):
 * an absent card must not be mistaken for an absent record.
 */
export function Restricted({ title, reason }: { title: string; reason?: string }) {
  return (
    <section
      className="card restricted"
      aria-labelledby={`restricted-${title.replace(/\W+/g, '-')}`}
    >
      <div className="card-header">
        <h3 id={`restricted-${title.replace(/\W+/g, '-')}`}>{title}</h3>
        <Badge tone="muted">Restricted</Badge>
      </div>
      <p className="restricted-body">
        Restricted information.{reason === undefined ? '' : ` ${reason}`}
      </p>
    </section>
  );
}
