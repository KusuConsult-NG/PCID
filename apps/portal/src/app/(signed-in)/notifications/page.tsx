import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { Badge, Empty } from '@/components/feedback';
import { SubmitButton } from '@/components/form';
import { callApi, dataOr } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { NotificationInbox } from '@/lib/types';

import { markRead } from './actions';

export const metadata: Metadata = { title: 'Messages' };

export default async function NotificationsPage() {
  const inbox = dataOr(await callApi<NotificationInbox>('/api/v1/me/notifications?limit=50'), null);

  return (
    <>
      <PageHeader
        title="Messages"
        lead="Updates about your record, your requests and anything you have reported."
      />

      <section className="card" aria-labelledby="inbox-heading">
        <div className="card-header">
          <h2 id="inbox-heading">Your messages</h2>
          {inbox !== null && inbox.unread > 0 ? (
            <Badge tone="info">{inbox.unread} unread</Badge>
          ) : null}
        </div>

        {inbox === null || inbox.notifications.length === 0 ? (
          <Empty>You have no messages.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {inbox.notifications.map((message) => (
              <li
                key={message.id}
                className="card"
                style={{
                  boxShadow: 'none',
                  background: message.read ? 'transparent' : 'var(--info-wash)',
                }}
              >
                <div className="card-header">
                  <h3 style={{ fontSize: 'var(--step-1)' }}>{message.subject ?? 'Message'}</h3>
                  {message.read ? null : <Badge tone="info">New</Badge>}
                </div>
                <p>{message.body}</p>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  {formatDateTime(message.receivedAt)}
                  {message.incidentNumber === null ? null : (
                    <>
                      {' · '}
                      <span className="mono">{message.incidentNumber}</span>
                    </>
                  )}
                </p>
                {message.read ? null : (
                  <form action={markRead} style={{ marginTop: '0.75rem' }}>
                    <input type="hidden" name="notificationId" value={message.id} />
                    <SubmitButton className="button button-quiet" pendingLabel="Marking…">
                      Mark as read
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
