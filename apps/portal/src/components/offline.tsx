'use client';

import {
  erase,
  eraseEverything,
  held,
  keep,
  offlineStorageAvailable,
  readDeviceToken,
  registerServiceWorker,
  writeDeviceToken,
} from '@pcid/portal-kit/offline';
import { useCallback, useEffect, useState } from 'react';

import { cardStillStands, registerThisDevice, takeCardOffline } from '@/lib/offline-actions';

/**
 * Keeping a Plateau Citizen ID on a phone (master system prompt §56).
 *
 * This is the portal's second reason to run JavaScript, after the submit button
 * that dims itself. It is a narrow one: a resident in a queue at a counter with
 * no coverage still has to be able to show the identifier that the whole
 * platform is organised around, and a page that can only be rendered by a server
 * they cannot reach is no use to them.
 */

const CARD_ID = 'citizen:card';

export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}

type State =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'held'; expiresAt: string }
  | { phase: 'refused'; message: string };

export function KeepCardOffline(): React.JSX.Element {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    setAvailable(offlineStorageAvailable());
    if (!offlineStorageAvailable()) return;
    void (async () => {
      const existing = await held<{ releaseId: string }>(CARD_ID);
      if (existing === null) return;
      const token = await readDeviceToken();
      if (token !== null) {
        const standing = await cardStillStands(existing.releaseId, token);
        if (!standing.valid) {
          await erase(CARD_ID);
          return;
        }
      }
      setState({ phase: 'held', expiresAt: existing.expiresAt });
    })();
  }, []);

  const take = useCallback(async () => {
    setState({ phase: 'working' });
    try {
      let token = await readDeviceToken();
      if (token === null) {
        const registration = await registerThisDevice();
        if (!registration.ok || registration.deviceToken === undefined) {
          setState({
            phase: 'refused',
            message: registration.message ?? 'This phone could not be registered.',
          });
          return;
        }
        token = registration.deviceToken;
        await writeDeviceToken(token);
      }
      const result = await takeCardOffline(token);
      if (!result.ok || result.card === undefined) {
        if (result.forget === true) await eraseEverything();
        setState({ phase: 'refused', message: result.message ?? 'That could not be done.' });
        return;
      }
      await keep({
        id: CARD_ID,
        kind: result.card.kind,
        releaseId: result.card.releaseId,
        expiresAt: result.card.expiresAt,
        payload: result.card,
      });
      setState({ phase: 'held', expiresAt: result.card.expiresAt });
    } catch (error) {
      setState({ phase: 'refused', message: (error as Error).message });
    }
  }, []);

  const drop = useCallback(async () => {
    await erase(CARD_ID);
    setState({ phase: 'idle' });
  }, []);

  if (!available) {
    return (
      <p className="small muted">
        This browser cannot keep anything on the phone. Write your Plateau Citizen ID down instead.
      </p>
    );
  }

  return (
    <div className="offline-control">
      {state.phase === 'held' ? (
        <>
          <p>
            <strong>Kept on this phone</strong> until{' '}
            <time dateTime={state.expiresAt}>{new Date(state.expiresAt).toLocaleString()}</time>.
            Open <a href="/offline">this page</a> to see it when you have no signal.
          </p>
          <button type="button" className="secondary" onClick={() => void drop()}>
            Remove it from this phone
          </button>
        </>
      ) : (
        <>
          <p className="small muted">
            Keep your Plateau Citizen ID on this phone so you can show it where there is no signal.
            Only the identifier and your name are kept, they are locked to this phone, and they are
            removed after a day.
          </p>
          <button
            type="button"
            onClick={() => void take()}
            disabled={state.phase === 'working'}
            aria-busy={state.phase === 'working'}
          >
            {state.phase === 'working' ? 'Saving…' : 'Keep on this phone'}
          </button>
        </>
      )}
      {state.phase === 'refused' ? (
        <p role="alert" className="small danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/** The `/offline` screen: the card, read from the phone itself. */
export function OfflineCard(): React.JSX.Element {
  const [card, setCard] = useState<
    { pcid: string; displayName: string; expiresAt: string } | null | 'none'
  >(null);

  useEffect(() => {
    if (!offlineStorageAvailable()) {
      setCard('none');
      return;
    }
    void held<{ records: { data: Record<string, unknown> }[] }>(CARD_ID).then((found) => {
      const data = found?.payload.records[0]?.data;
      if (found === null || data === undefined) {
        setCard('none');
        return;
      }
      setCard({
        pcid: String(data.pcid ?? ''),
        displayName: String(data.displayName ?? ''),
        expiresAt: found.expiresAt,
      });
    });
  }, []);

  if (card === null) return <p className="muted">Looking…</p>;
  if (card === 'none') {
    return (
      <p>
        Nothing is kept on this phone. When you next have a signal, open{' '}
        <a href="/identity">Your identity</a> and choose <strong>Keep on this phone</strong>.
      </p>
    );
  }
  return (
    <div className="offline-card">
      <p className="offline-card-name">{card.displayName}</p>
      <p className="offline-card-pcid mono">{card.pcid}</p>
      <p className="small muted">
        Kept on this phone until{' '}
        <time dateTime={card.expiresAt}>{new Date(card.expiresAt).toLocaleString()}</time>. An
        officer checks it against the register; this screen on its own proves nothing.
      </p>
    </div>
  );
}
