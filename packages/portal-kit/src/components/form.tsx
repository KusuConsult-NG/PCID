'use client';

import { useFormStatus } from 'react-dom';

/**
 * A submit button that disables itself while the action is in flight.
 *
 * The only client component in the portal, and it is progressive: without
 * JavaScript the form still submits, the button simply does not dim.
 */
export function SubmitButton({
  children,
  className = 'button',
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}
