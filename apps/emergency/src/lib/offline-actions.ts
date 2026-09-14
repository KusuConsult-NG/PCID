'use server';

import { callApi } from './api';

/**
 * The server half of the offline mode (§56).
 *
 * The browser holds the device secret and the sealed bundle; the portal holds
 * the session and the only route to the platform. Neither holds the other's, and
 * that is what keeps the portal's central property intact: an API token still
 * never reaches the browser, and what does reach it is data the platform already
 * released to this person, not authority to ask for more.
 */

export interface DeviceRegistration {
  readonly ok: boolean;
  readonly deviceId?: string;
  readonly deviceToken?: string;
  readonly message?: string;
}

export async function registerThisDevice(label: string): Promise<DeviceRegistration> {
  const result = await callApi<{ deviceId: string; deviceToken: string }>('/api/v1/me/devices', {
    method: 'POST',
    // The platform records a label so the crew recognises the tablet in a list
    // of their own devices when one of them goes missing.
    body: { label: label.trim() === '' ? 'Responder device' : label.trim(), platform: 'ANDROID' },
  });
  return result.ok
    ? { ok: true, deviceId: result.data.deviceId, deviceToken: result.data.deviceToken }
    : { ok: false, message: result.error.message };
}

export interface OfflineBundleResult {
  readonly ok: boolean;
  readonly bundle?: {
    kind: string;
    releaseId: string;
    expiresAt: string;
    notice: string;
    records: { subject: string; data: Record<string, unknown>; restrictedFields: string[] }[];
  };
  readonly message?: string;
  /** Set when the platform says this device may hold nothing further. */
  readonly forget?: boolean;
}

export async function takeIncidentOffline(
  reference: string,
  deviceToken: string,
): Promise<OfflineBundleResult> {
  const result = await callApi<OfflineBundleResult['bundle']>(
    `/api/v1/incidents/${encodeURIComponent(reference)}/offline-bundle`,
    { deviceToken },
  );
  if (result.ok) return { ok: true, bundle: result.data };
  return {
    ok: false,
    message: result.error.message,
    forget: result.status === 403 || result.status === 404,
  };
}

/**
 * What a device asks the moment it reaches the network again: may I still hold
 * this? Anything other than a clear yes is a no, because a client that guesses
 * in this direction is a client that keeps a casualty's blood group after the
 * crew was told to stop.
 */
export async function releaseStillStands(
  releaseId: string,
  deviceToken: string,
): Promise<{ valid: boolean }> {
  const result = await callApi<{ valid: boolean }>(
    `/api/v1/me/offline-releases/${encodeURIComponent(releaseId)}`,
    { deviceToken },
  );
  return { valid: result.ok && result.data.valid };
}
