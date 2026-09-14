'use client';

import { useState } from 'react';

/**
 * A unit reporting its own operational position.
 *
 * This is the only live location the platform holds, and it exists so control
 * can send the nearest thing to the next call. It is the *unit* that is
 * reporting, about itself, and the browser asks the crew before it does.
 *
 * There is no citizen equivalent anywhere in the platform and this component is
 * not the beginning of one: nothing here observes anybody, and a crew that
 * declines simply leaves control with the last position it had.
 */
export function ReportPosition() {
  const [state, setState] = useState<'off' | 'asking' | 'ready' | 'refused'>('off');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  function locate(): void {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setState('refused');
      return;
    }
    setState('asking');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
        setState('ready');
      },
      () => setState('refused'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  return (
    <div className="field">
      <button type="button" className="button button-secondary" onClick={locate}>
        Use this device&rsquo;s position
      </button>

      {coords === null ? null : (
        <>
          <input type="hidden" name="latitude" value={coords.latitude} />
          <input type="hidden" name="longitude" value={coords.longitude} />
        </>
      )}

      <p className="small muted" role="status" aria-live="polite" style={{ marginBottom: 0 }}>
        {state === 'off'
          ? 'Or type the coordinates below. Your device will ask you before it shares anything.'
          : null}
        {state === 'asking' ? 'Finding this vehicle…' : null}
        {state === 'ready' && coords !== null
          ? `Ready to report ${coords.latitude}, ${coords.longitude}.`
          : null}
        {state === 'refused'
          ? 'This device did not give a position. Type the coordinates below, or leave it — control keeps the last position it had.'
          : null}
      </p>
    </div>
  );
}
