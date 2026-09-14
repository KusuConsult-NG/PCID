/**
 * Where the government portal's end-to-end suite runs.
 *
 * Its own ports and its own database, distinct from the citizen portal's, so
 * the two suites can run at the same time and neither touches a developer's
 * working database or the API they have open in another terminal.
 */
import { resolve } from 'node:path';

const here = __dirname;

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3402);
export const PORTAL_PORT = Number(process.env.E2E_PORTAL_PORT ?? 3403);

export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
export const PORTAL_BASE_URL = `http://127.0.0.1:${PORTAL_PORT}`;

export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
export const DATABASE_NAME = process.env.E2E_DATABASE_NAME ?? 'pcid_e2e_gov';
export const DATABASE_URL = ADMIN_DATABASE_URL.replace(/\/[^/]+$/, `/${DATABASE_NAME}`);

/**
 * Fixed keys, for a database that is destroyed at the end of the run.
 *
 * The signing and encryption keys have to be shared with the seed command:
 * authenticator secrets are stored under an envelope, so a seed written with
 * one key is unreadable to a service holding another.
 */
export const PORTAL_SESSION_KEY = 'Z292LWUyZS1zZXNzaW9uLWtleS1mb3ItdGVzdHMtMDA';
export const TOKEN_SIGNING_KEY = 'ZTJlLXRva2VuLXNpZ25pbmcta2V5LWZvci10ZXN0czAw';
export const SECRET_ENCRYPTION_KEY = 'ZTJlLXNlY3JldC1lbmNyeXB0aW9uLWtleS10ZXN0czA';

export const API_DIRECTORY = resolve(here, '../../../services/api');
export const TYPESCRIPT_COMPILER = resolve(here, '../../../node_modules/typescript/bin/tsc');
export const ARTEFACT_DIRECTORY = resolve(here, '.artefacts');
/** Written by the setup project, read by every spec. */
export const CREDENTIALS_FILE = resolve(ARTEFACT_DIRECTORY, 'demo.json');

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

/** The passphrase each officer chooses on first sign-in. */
export const CHOSEN_PASSPHRASE = 'Kerang-Plateau-Basalt-77';

/** Which demo officer a spec signs in as. */
export type OfficerRole =
  'REGISTRATION_OFFICER' | 'VERIFICATION_OFFICER' | 'DATA_PROTECTION_OFFICER';

export const STATE_FILES: Readonly<Record<OfficerRole, string>> = {
  REGISTRATION_OFFICER: resolve(ARTEFACT_DIRECTORY, 'registrar-state.json'),
  VERIFICATION_OFFICER: resolve(ARTEFACT_DIRECTORY, 'counter-state.json'),
  DATA_PROTECTION_OFFICER: resolve(ARTEFACT_DIRECTORY, 'dpo-state.json'),
};
