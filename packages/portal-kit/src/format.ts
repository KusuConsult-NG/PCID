/**
 * Presentation helpers shared by the portals.
 *
 * Dates are shown in the state's civil time, because somebody checking when a
 * record was opened needs to know whether "14:05" means their afternoon.
 *
 * The platform's vocabulary - purposes, actions - is deliberately *not*
 * translated here. "Viewed your record" and "Viewed the record" are the same
 * event described to two different audiences, and a shared label would end up
 * being wrong for one of them.
 */
const DATE_TIME = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
});

const DATE_ONLY = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'long',
  timeZone: 'Africa/Lagos',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (iso == null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_TIME.format(parsed);
}

export function formatDate(iso: string | null | undefined): string {
  if (iso == null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_ONLY.format(parsed);
}

export function sentenceCase(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Field paths come back as `registeredAddress`; residents read "Registered address". */
export function fieldLabel(field: string): string {
  const bare = field.includes('.') ? (field.split('.').pop() as string) : field;
  const spaced = bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Group a PCID for reading aloud, without changing what it is. */
export function formatPcid(pcid: string): string {
  return pcid.toUpperCase();
}

export function relativeMinutes(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}
