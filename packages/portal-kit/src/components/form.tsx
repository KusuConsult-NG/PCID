'use client';

import { useFormStatus } from 'react-dom';

/**
 * A submit button that disables itself while the action is in flight.
 *
 * Progressive: without JavaScript the form still submits, the button simply
 * does not dim. It is deliberately the only client component the portals use.
 */
export function SubmitButton({
  children,
  className = 'button',
  pendingLabel,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  /** For a form with more than one outcome: which button was pressed. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
      name={name}
      value={value}
    >
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}
