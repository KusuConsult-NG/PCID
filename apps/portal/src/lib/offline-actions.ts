'use server';

import { callApi } from './api';

/**
 * The server half of the resident's offline card (§56).
 *
 * The same shape as the responder's, and for a much smaller payload: a
 * Plateau Citizen ID and the name printed on it. What a resident needs where
 * there is no coverage is the thing they have to show somebody, and nothing
 * else — their address, their emergency contacts and their access history are
 * read in the portal, online, where the access is decided and logged.
 */

export interface DeviceRegistration {
  readonly ok: boolean;
  readonly deviceToken?: string;
  readonly message?: string;
}

export async function registerThisDevice(): Promise<DeviceRegistration> {
  const result = await callApi<{ deviceId: string; deviceToken: string }>('/api/v1/me/devices', {
    method: 'POST',
    body: { label: 'My phone', platform: 'ANDROID' },
  });
  return result.ok
    ? { ok: true, deviceToken: result.data.deviceToken }
    : { ok: false, message: result.error.message };
}

export interface CardResult {
  readonly ok: boolean;
  readonly card?: {
    kind: string;
    releaseId: string;
    expiresAt: string;
    notice: string;
    records: { subject: string; data: Record<string, unknown> }[];
  };
  readonly message?: string;
  readonly forget?: boolean;
}

export async function takeCardOffline(deviceToken: string): Promise<CardResult> {
  const result = await callApi<CardResult['card']>('/api/v1/me/offline-card', { deviceToken });
  if (result.ok) return { ok: true, card: result.data };
  return {
    ok: false,
    message: result.error.message,
    forget: result.status === 403 || result.status === 404,
  };
}

export async function cardStillStands(
  releaseId: string,
  deviceToken: string,
): Promise<{ valid: boolean }> {
  const result = await callApi<{ valid: boolean }>(
    `/api/v1/me/offline-releases/${encodeURIComponent(releaseId)}`,
    { deviceToken },
  );
  return { valid: result.ok && result.data.valid };
}
