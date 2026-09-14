import { TotpService } from '../security/totp.service';
import { Recorder } from './metrics';
import type { RunSummary } from './metrics';
import { SeededRandom, weightedChoice } from './random';
import { scenariosFor } from './scenarios';
import type { Profile, Scenario, Workspace } from './scenarios';
import type { LoadAccount, LoadManifest } from './volume';

/**
 * The load driver (§81).
 *
 * Closed loop: a fixed number of virtual users, each issuing one request at a
 * time and starting the next when the last returns. That is stated plainly
 * because it decides what the numbers mean. A closed loop cannot produce a queue
 * the server has no chance of clearing, so it answers "what does the platform do
 * at this concurrency" and not "what happens when a thousand people arrive at
 * once". The second question is the one a denial-of-service control answers, and
 * the rate limiter is where it is answered.
 *
 * Every virtual user signs in as its own account, with its own password and its
 * own authenticator. A harness that shared one login would spend the run
 * measuring the per-account rate limiter.
 */

export interface DriverOptions {
  readonly baseUrl: string;
  readonly profile: Profile;
  readonly virtualUsers: number;
  readonly durationSeconds: number;
  readonly warmupSeconds: number;
  readonly rampSeconds: number;
  /** Pause between a user's requests. Zero drives the platform as hard as it goes. */
  readonly thinkMs: number;
  readonly seed: number;
  readonly timeoutMs: number;
}

export interface DriverEvents {
  (message: string): void;
}

interface Session {
  readonly account: LoadAccount;
  readonly scenarios: readonly Scenario[];
  readonly random: SeededRandom;
  readonly workspace: Workspace;
  token: string;
  lastTotpCounter: number;
}

export async function runLoad(
  manifest: LoadManifest,
  options: DriverOptions,
  log: DriverEvents,
): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const recorder = new Recorder();
  const totp = new TotpService();

  const assignments = assignUsers(manifest.accounts, options.profile, options.virtualUsers);
  if (assignments.length === 0) {
    throw new Error('No accounts matched the profile. Re-run the load seed.');
  }
  log(`signing in ${assignments.length} virtual users`);

  const sessions: Session[] = [];
  for (const [index, account] of assignments.entries()) {
    const session: Session = {
      account,
      scenarios: scenariosFor(account.persona),
      random: new SeededRandom(options.seed + index * 7919),
      workspace: { caseNumbers: [], incidentNumbers: [], pcids: [] },
      token: '',
      lastTotpCounter: -1,
    };
    await authenticate(session, options, totp);
    await loadWorkspace(session, options);
    sessions.push(session);
  }

  const beganAtMs = Date.now();
  const measureFromMs = beganAtMs + options.warmupSeconds * 1000;
  const endsAtMs = measureFromMs + options.durationSeconds * 1000;
  log(
    `warm-up ${options.warmupSeconds}s, measuring ${options.durationSeconds}s, ` +
      `ramp ${options.rampSeconds}s`,
  );

  await Promise.all(
    sessions.map(async (session, index) => {
      // Stagger the starts. Forty users signing in and searching on the same
      // millisecond is a thundering herd, not a working day.
      const delay =
        options.rampSeconds === 0
          ? 0
          : Math.floor((index / sessions.length) * options.rampSeconds * 1000);
      if (delay > 0) await sleep(delay);
      await driveOne(session, manifest, options, recorder, endsAtMs, totp);
    }),
  );

  recorder.discardBefore(measureFromMs);
  return recorder.summarise(sessions.length, startedAt);
}

/** Divide the virtual users between the desks according to the profile. */
export function assignUsers(
  accounts: readonly LoadAccount[],
  profile: Profile,
  virtualUsers: number,
): LoadAccount[] {
  const byPersona = new Map<string, LoadAccount[]>();
  for (const account of accounts) {
    const list = byPersona.get(account.persona);
    if (list === undefined) byPersona.set(account.persona, [account]);
    else list.push(account);
  }

  const chosen: LoadAccount[] = [];
  const personas = Object.entries(profile.mix).sort((a, b) => b[1] - a[1]);
  for (const [persona, share] of personas) {
    const available = byPersona.get(persona) ?? [];
    const wanted = Math.round(virtualUsers * share);
    if (available.length === 0) continue;
    for (let index = 0; index < wanted && chosen.length < virtualUsers; index += 1) {
      // One account per virtual user while there are accounts to go round; if a
      // run asks for more users than the seed created, accounts are reused and
      // the run will meet the per-account rate limit. The report says so.
      chosen.push(available[index % available.length] as LoadAccount);
    }
  }
  // Rounding can leave a seat empty; fill it from the busiest desk.
  const first = personas[0]?.[0];
  const fallback = first === undefined ? [] : (byPersona.get(first) ?? []);
  while (chosen.length < virtualUsers && fallback.length > 0) {
    chosen.push(fallback[chosen.length % fallback.length] as LoadAccount);
  }
  return chosen;
}

async function driveOne(
  session: Session,
  manifest: LoadManifest,
  options: DriverOptions,
  recorder: Recorder,
  endsAtMs: number,
  totp: TotpService,
): Promise<void> {
  while (Date.now() < endsAtMs) {
    const scenario = weightedChoice(session.scenarios, session.random.next());
    const request = scenario.build({
      samples: manifest.samples,
      random: session.random,
      workspace: session.workspace,
    });
    if (request === null) {
      await sleep(5);
      continue;
    }

    const startedAtMs = Date.now();
    const result = await issue(session, request, options);
    recorder.record({
      scenario: scenario.name,
      status: result.status,
      ok: scenario.answers.includes(result.status),
      durationMs: Date.now() - startedAtMs,
      startedAtMs,
      error: result.error,
    });

    if (result.status === 401) {
      // The access token expired, or the session was revoked. Sign in again, as
      // the portal would, and carry on.
      await authenticate(session, options, totp).catch(() => undefined);
    } else if (result.status === 200) {
      remember(session, result.body);
    }

    if (options.thinkMs > 0) await sleep(options.thinkMs);
  }
}

/**
 * Keep what a request found, so the next one names something real: a view
 * follows a search, and a case file follows the caseload.
 */
function remember(session: Session, body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const record = body as Record<string, unknown>;
  // A search result is a projection: the record's fields arrive under their
  // catalogue paths, because that is the vocabulary the release decision speaks.
  collect(record.results, ['citizen.pcid', 'pcid'], session.workspace.pcids, 200);
  collect(record.cases, ['caseNumber'], session.workspace.caseNumbers, 100);
  collect(record.incidents, ['incidentNumber'], session.workspace.incidentNumbers, 100);
}

function collect(value: unknown, keys: readonly string[], into: string[], cap: number): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const nested = record.data;
    const candidate = keys
      .flatMap((key) => [
        record[key],
        nested !== null && typeof nested === 'object'
          ? (nested as Record<string, unknown>)[key]
          : undefined,
      ])
      .find((found): found is string => typeof found === 'string' && found !== '');
    if (candidate !== undefined && !into.includes(candidate)) {
      if (into.length >= cap) into.shift();
      into.push(candidate);
    }
  }
}

interface Response {
  readonly status: number;
  readonly body: unknown;
  readonly error?: string;
}

async function issue(
  session: Session,
  request: { method: string; path: string; body?: unknown },
  options: DriverOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${options.baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${session.token}`,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    // Status 0 means the request never got an answer: a timeout, a refused
    // connection, a socket the server closed. Counted and reported separately
    // from anything the platform decided.
    return { status: 0, body: null, error: describe(error) };
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  const message = (error as Error)?.message ?? String(error);
  if (message.includes('aborted') || message.includes('AbortError')) return 'timeout';
  return message.split('\n')[0] ?? 'transport error';
}

async function authenticate(
  session: Session,
  options: DriverOptions,
  totp: TotpService,
): Promise<void> {
  const login = await postJson<{ accessToken: string }>(
    options,
    '/api/v1/auth/login',
    { email: session.account.email, password: session.account.password },
    null,
  );
  const claims = JSON.parse(
    Buffer.from(login.accessToken.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as { sid: string };

  // An authenticator code cannot be presented twice: the platform records the
  // counter it was issued for and refuses a replay. Wait for the next window
  // rather than fail the sign-in.
  let counter = Math.floor(Date.now() / 30_000);
  while (counter <= session.lastTotpCounter) {
    await sleep(1_000);
    counter = Math.floor(Date.now() / 30_000);
  }
  session.lastTotpCounter = counter;

  const verified = await postJson<{ accessToken: string }>(
    options,
    '/api/v1/auth/mfa/verify',
    { sessionId: claims.sid, code: totp.generate(session.account.totpSecret) },
    null,
  );
  session.token = verified.accessToken;
}

/** What an officer's first minute looks like: open the workspace, then work. */
async function loadWorkspace(session: Session, options: DriverOptions): Promise<void> {
  const openings: Record<string, string | undefined> = {
    // The working list, not the archive. Case-bound access is refused on a
    // closed case by design, and a harness that filled its workspace from the
    // whole caseload would spend half the run measuring that refusal instead of
    // the work an investigator actually does.
    investigator: '/api/v1/cases?status=ACTIVE&limit=50',
    dispatcher: '/api/v1/incidents?activeOnly=true&limit=50',
  };
  const path = openings[session.account.persona];
  if (path === undefined) return;
  const result = await issue(session, { method: 'GET', path }, options);
  if (result.status === 200) remember(session, result.body);
}

async function postJson<T>(
  options: DriverOptions,
  path: string,
  body: unknown,
  token: string | null,
): Promise<T> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed with ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
