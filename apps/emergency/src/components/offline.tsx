'use client';

import {
  eraseEverything,
  erase,
  held,
  keep,
  listHeld,
  offlineStorageAvailable,
  readDeviceToken,
  registerServiceWorker,
  writeDeviceToken,
} from '@pcid/portal-kit/offline';
import { useCallback, useEffect, useState } from 'react';

import { registerThisDevice, releaseStillStands, takeIncidentOffline } from '@/lib/offline-actions';

/**
 * The crew's offline controls (master system prompt §56).
 *
 * Two client components, which is two more than the portals had. Offline
 * capability cannot be server-rendered - the whole point is the moment the
 * server is unreachable - so this is where the portals run JavaScript, and the
 * boundary is drawn as narrowly as it can be: reading what the device holds,
 * sealing what it is given, and asking the platform whether it may still hold it.
 * No page renders citizen data from here; the pack is read on `/offline`, which
 * is the only screen that exists for it.
 */

/** Registers the shell worker and clears it again on sign-out. */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}

type State =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'held'; expiresAt: string; people: number }
  | { phase: 'refused'; message: string };

export function KeepIncidentOffline({
  reference,
  canHold,
}: {
  reference: string;
  canHold: boolean;
}): React.JSX.Element | null {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [available, setAvailable] = useState(true);
  const id = `incident:${reference}`;

  useEffect(() => {
    setAvailable(offlineStorageAvailable());
    if (!offlineStorageAvailable()) return;
    void (async () => {
      const existing = await held<{ records: unknown[] }>(id);
      if (existing === null) return;
      // Ask before showing it as held: the device may have been signed out while
      // this one was in a tunnel, and the answer decides whether it keeps it.
      const token = await readDeviceToken();
      if (token !== null) {
        const standing = await releaseStillStands(existing.releaseId, token);
        if (!standing.valid) {
          await erase(id);
          setState({ phase: 'idle' });
          return;
        }
      }
      setState({
        phase: 'held',
        expiresAt: existing.expiresAt,
        people: existing.payload.records.length,
      });
    })();
  }, [id]);

  const take = useCallback(async () => {
    setState({ phase: 'working' });
    try {
      let token = await readDeviceToken();
      if (token === null) {
        const registration = await registerThisDevice('Responder device');
        if (!registration.ok || registration.deviceToken === undefined) {
          setState({
            phase: 'refused',
            message: registration.message ?? 'Could not register this device.',
          });
          return;
        }
        token = registration.deviceToken;
        await writeDeviceToken(token);
      }

      const result = await takeIncidentOffline(reference, token);
      if (!result.ok || result.bundle === undefined) {
        if (result.forget === true) await eraseEverything();
        setState({
          phase: 'refused',
          message: result.message ?? 'This incident cannot be held offline.',
        });
        return;
      }
      await keep({
        id,
        kind: result.bundle.kind,
        releaseId: result.bundle.releaseId,
        expiresAt: result.bundle.expiresAt,
        payload: result.bundle,
      });
      setState({
        phase: 'held',
        expiresAt: result.bundle.expiresAt,
        people: result.bundle.records.length,
      });
    } catch (error) {
      setState({ phase: 'refused', message: (error as Error).message });
    }
  }, [id, reference]);

  const drop = useCallback(async () => {
    await erase(id);
    setState({ phase: 'idle' });
  }, [id]);

  if (!canHold) return null;
  if (!available) {
    return (
      <p className="muted small">
        This browser cannot hold anything offline. Keep a radio channel open instead.
      </p>
    );
  }

  return (
    <div className="offline-control">
      {state.phase === 'held' ? (
        <>
          <p>
            <strong>Held on this device</strong> — {state.people}{' '}
            {state.people === 1 ? 'person' : 'people'}, until{' '}
            <time dateTime={state.expiresAt}>{new Date(state.expiresAt).toLocaleTimeString()}</time>
            . It is erased when it expires, and when this device is signed out.
          </p>
          <button type="button" className="secondary" onClick={() => void drop()}>
            Erase it now
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            Keep this incident’s people on this device so you can read them where there is no
            signal. Nothing else about them is held, and it expires in four hours.
          </p>
          <button
            type="button"
            onClick={() => void take()}
            disabled={state.phase === 'working'}
            aria-busy={state.phase === 'working'}
          >
            {state.phase === 'working' ? 'Preparing…' : 'Keep for offline'}
          </button>
        </>
      )}
      {state.phase === 'refused' ? (
        <p role="alert" className="danger small">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export interface HeldSummary {
  readonly id: string;
  readonly kind: string;
  readonly expiresAt: string;
}

interface Pack {
  readonly notice: string;
  readonly records: readonly {
    subject: string;
    data: Record<string, unknown>;
    restrictedFields: string[];
  }[];
}

/**
 * The `/offline` screen: what this device holds, and the pack itself.
 *
 * One page rather than a list that links to detail pages, because a link is a
 * navigation and a navigation needs a document the worker has cached. The list
 * and the reading happen in the same cached document, so the whole screen works
 * with the radio off - which is the only circumstance it exists for.
 */
export function OfflineReader(): React.JSX.Element {
  const [items, setItems] = useState<readonly HeldSummary[] | null>(null);
  const [open, setOpen] = useState<{ id: string; pack: Pack; expiresAt: string } | null>(null);

  useEffect(() => {
    if (!offlineStorageAvailable()) {
      setItems([]);
      return;
    }
    void listHeld().then((found) =>
      setItems(
        found
          .filter((entry) => Date.parse(entry.expiresAt) > Date.now())
          .map((entry) => ({ id: entry.id, kind: entry.kind, expiresAt: entry.expiresAt })),
      ),
    );
  }, []);

  const read = useCallback(async (id: string) => {
    const found = await held<Pack>(id);
    // `held` erases an expired bundle on the way past, so a null here means
    // there is genuinely nothing to show - not that something went wrong.
    if (found === null) {
      setOpen(null);
      setItems((current) => (current ?? []).filter((entry) => entry.id !== id));
      return;
    }
    setOpen({ id, pack: found.payload, expiresAt: found.expiresAt });
  }, []);

  if (items === null) return <p className="muted">Looking at what this device holds…</p>;
  if (items.length === 0) {
    return (
      <p>
        This device is holding nothing. Open an incident while you have a signal and choose{' '}
        <strong>Keep for offline</strong> before you go.
      </p>
    );
  }

  return (
    <>
      <ul className="held-list">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="secondary" onClick={() => void read(item.id)}>
              {item.id.replace('incident:', 'Incident ')}
            </button>{' '}
            <span className="muted small">
              until{' '}
              <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString()}</time>
            </span>
          </li>
        ))}
      </ul>

      {open === null ? null : (
        <section className="card" aria-labelledby="held-heading">
          <div className="card-header">
            <h2 id="held-heading">{open.id.replace('incident:', 'Incident ')}</h2>
          </div>
          <p className="muted small">{open.pack.notice}</p>
          {open.pack.records.length === 0 ? (
            <p>Nobody was attached to this incident when it was taken offline.</p>
          ) : (
            open.pack.records.map((record) => (
              <article key={record.subject} className="held-person">
                <h3>{String(record.data.displayName ?? 'Not recorded')}</h3>
                <dl>
                  {Object.entries(record.data)
                    .filter(([field]) => field !== 'displayName')
                    .map(([field, value]) => (
                      <div key={field}>
                        <dt>{field}</dt>
                        <dd>{renderValue(value)}</dd>
                      </div>
                    ))}
                </dl>
                {record.restrictedFields.length === 0 ? null : (
                  <p className="muted small">
                    Restricted information, withheld from this release:{' '}
                    {record.restrictedFields.join(', ')}.
                  </p>
                )}
              </article>
            ))
          )}
        </section>
      )}
    </>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (Array.isArray(value)) {
    return value.length === 0
      ? 'None recorded'
      : value.map((entry) => renderValue(entry)).join('; ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([field, nested]) => `${field}: ${renderValue(nested)}`)
      .join(', ');
  }
  return String(value);
}
