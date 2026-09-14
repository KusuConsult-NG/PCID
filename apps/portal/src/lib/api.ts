import { createApiClient } from '@pcid/portal-kit/api';

import { env } from './env';
import { sessions } from './session';
import type { PortalSession } from './session';

/** The resident's only route to the platform. Server-side, always. */
export const callApi = createApiClient<PortalSession>({
  baseUrl: () => env.apiBaseUrl,
  sessions,
});

export { dataOr } from '@pcid/portal-kit/api';
export type { ApiError, ApiResult } from '@pcid/portal-kit/api';
