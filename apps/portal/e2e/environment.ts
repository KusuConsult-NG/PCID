/**
 * Where the end-to-end suite runs.
 *
 * Deliberately on ports of its own, against a database of its own: running the
 * suite must never touch a developer's working database or the API they have
 * open in another terminal.
 */
import { resolve } from 'node:path';

const here = __dirname;

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3400);
export const PORTAL_PORT = Number(process.env.E2E_PORTAL_PORT ?? 3401);

export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
export const PORTAL_BASE_URL = `http://127.0.0.1:${PORTAL_PORT}`;

export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
export const DATABASE_NAME = process.env.E2E_DATABASE_NAME ?? 'pcid_e2e';
export const DATABASE_URL = ADMIN_DATABASE_URL.replace(/\/[^/]+$/, `/${DATABASE_NAME}`);

/**
 * Fixed keys, for a database that is destroyed at the end of the run.
 *
 * The signing and encryption keys have to be shared with the seed command:
 * authenticator secrets are stored under an envelope, so a seed written with
 * one key is unreadable to a service holding another.
 */
export const PORTAL_SESSION_KEY = 'ZTJlLXNlc3Npb24ta2V5LWZvci10ZXN0cy1vbmx5MDA';
export const TOKEN_SIGNING_KEY = 'ZTJlLXRva2VuLXNpZ25pbmcta2V5LWZvci10ZXN0czAw';
export const SECRET_ENCRYPTION_KEY = 'ZTJlLXNlY3JldC1lbmNyeXB0aW9uLWtleS10ZXN0czA';

export const API_DIRECTORY = resolve(here, '../../../services/api');
export const TYPESCRIPT_COMPILER = resolve(here, '../../../node_modules/typescript/bin/tsc');
export const ARTEFACT_DIRECTORY = resolve(here, '.artefacts');
/** Written by the setup project, read by every spec. */
export const CREDENTIALS_FILE = resolve(ARTEFACT_DIRECTORY, 'demo.json');
export const RESIDENT_STATE_FILE = resolve(ARTEFACT_DIRECTORY, 'resident-state.json');

export interface DemoCredentials {
  readonly citizen: { readonly pcid: string; readonly temporaryPassword: string };
  readonly administrator: { readonly email: string; readonly password: string };
  readonly officers: readonly {
    readonly email: string;
    readonly password: string;
    readonly totpSecret: string;
    readonly roles: readonly string[];
  }[];
}

/** The passphrase the resident chooses on first sign-in. */
export const CHOSEN_PASSPHRASE = 'Harmattan-Riverbed-Lantern-41';
