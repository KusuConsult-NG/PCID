import type { PolicyDecision } from '@pcid/policy';

/**
 * Turn a stored record into a response body using only what the decision released.
 *
 * Call sites build a map keyed by *catalogue field path* (`citizen.dateOfBirth`),
 * and this is the only function that unwraps it. A field the decision did not
 * release cannot appear in the output, and a field the caller forgot to add to
 * the map simply does not appear - there is no path by which an un-catalogued
 * value reaches a client.
 */
export function project(
  decision: PolicyDecision,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (decision.effect !== 'PERMIT') return {};
  const output: Record<string, unknown> = {};
  for (const field of decision.allowedFields) {
    if (!(field in values)) continue;
    const value = values[field];
    if (value === undefined) continue;
    const key = field.includes('.') ? (field.split('.').slice(1).join('.') as string) : field;
    output[key] = value;
  }
  return output;
}

/**
 * The fields deliberately withheld, as short keys, so an interface can render
 * "Restricted information" against the right rows (§29).
 */
export function withheld(decision: PolicyDecision): readonly string[] {
  return decision.withheldFields.map((entry) =>
    entry.field.includes('.') ? entry.field.split('.').slice(1).join('.') : entry.field,
  );
}
