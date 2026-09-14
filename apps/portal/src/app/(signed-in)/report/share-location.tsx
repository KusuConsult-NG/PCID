'use client';

import { useState } from 'react';

/**
 * Optional location sharing for an emergency report.
 *
 * Nothing happens unless the resident ticks the box, and the browser then asks
 * its own permission. If they decline, or the device cannot fix a position, the
 * report still goes — the platform falls back to the registered address and
 * records which it used. The portal never obtains a position silently.
 */
export function ShareLocation() {
  const [state, setState] = useState<'off' | 'asking' | 'shared' | 'refused'>('off');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  function toggle(checked: boolean): void {
    if (!checked) {
      setState('off');
      setCoords(null);
      return;
    }
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
        setState('shared');
      },
      () => setState('refused'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  return (
    <div className="field">
      <label
        className="label"
        htmlFor="shareLocation"
        style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}
      >
        <input
          id="shareLocation"
          name="shareLocation"
          type="checkbox"
          style={{ width: '1.4rem', height: '1.4rem', marginTop: '0.15rem' }}
          onChange={(event) => toggle(event.currentTarget.checked)}
        />
        <span>
          Share where I am now
          <span className="hint" style={{ fontWeight: 400 }}>
            Your phone will ask you first. Without this, responders are sent to your registered
            address.
          </span>
        </span>
      </label>

      {coords === null ? null : (
        <>
          <input type="hidden" name="latitude" value={coords.latitude} />
          <input type="hidden" name="longitude" value={coords.longitude} />
        </>
      )}

      <p className="small muted" role="status" aria-live="polite" style={{ marginBottom: 0 }}>
        {state === 'asking' ? 'Finding your location…' : null}
        {state === 'shared' ? 'Your location will be sent with this report.' : null}
        {state === 'refused'
          ? 'Your location was not shared. The report will still be sent, using your registered address.'
          : null}
      </p>
    </div>
  );
}
