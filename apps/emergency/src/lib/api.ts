import { createApiClient } from '@pcid/portal-kit/api';

import { env } from './env';
import { sessions } from './session';
import type { EmergencySession } from './session';

/** The responder's only route to the platform. Server-side, always. */
export const callApi = createApiClient<EmergencySession>({
  baseUrl: () => env.apiBaseUrl,
  sessions,
});

export { dataOr } from '@pcid/portal-kit/api';
export type { ApiError, ApiResult } from '@pcid/portal-kit/api';
