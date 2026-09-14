import { z } from 'zod';

/**
 * Configuration is validated once, at boot. A missing or malformed value stops
 * the process rather than surfacing as a runtime failure in a request path -
 * which for a platform holding a citizen registry is the safe direction.
 */
const durationSeconds = z.coerce.number().int().positive();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_CA_CERT: z.string().optional(),

  REDIS_URL: z.string().optional(),

  /**
   * Signing key for access tokens, and the separate key that encrypts MFA
   * secrets at rest. Both are 32-byte values supplied base64url-encoded, and the
   * platform refuses to start with a short or reused key.
   */
  TOKEN_SIGNING_KEY: z
    .string()
    .min(43, 'TOKEN_SIGNING_KEY must be at least 32 bytes, base64url encoded'),
  SECRET_ENCRYPTION_KEY: z
    .string()
    .min(43, 'SECRET_ENCRYPTION_KEY must be at least 32 bytes, base64url encoded'),

  ACCESS_TOKEN_TTL_SECONDS: durationSeconds.default(900),
  REFRESH_TOKEN_TTL_SECONDS: durationSeconds.default(60 * 60 * 8),
  AAL2_TTL_SECONDS: durationSeconds.default(600),

  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_SECONDS: durationSeconds.default(900),

  RATE_LIMIT_WINDOW_SECONDS: durationSeconds.default(60),
  RATE_LIMIT_DEFAULT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(20),
  /**
   * The largest result set a registry search will return (§63, §81).
   *
   * A search matching more people than this is refused with advice on what to
   * add, rather than paged. Configurable because the right number depends on the
   * size of the register: at four million records a name alone matches a hundred
   * thousand people, and paging through them is browsing the register.
   */
  SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(100_000).default(1_000),
  SEARCH_VOLUME_ALERT_THRESHOLD: z.coerce.number().int().positive().default(60),
  SEARCH_VOLUME_WINDOW_SECONDS: durationSeconds.default(3600),

  STATE_TIMEZONE: z.string().default('Africa/Lagos'),
  PLATFORM_BASE_URL: z.string().url().default('http://localhost:3000'),
  VERIFICATION_BASE_URL: z.string().url().default('http://localhost:3000/verify'),

  /**
   * Integration adapters run in PRODUCTION or SANDBOX per data source, read from
   * the `data_source` table. This flag is the safety catch: in production
   * deployments the sandbox adapters refuse to load at all (§77, §78).
   */
  ALLOW_SANDBOX_ADAPTERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * Notification delivery (§33, §58).
   *
   * A channel with no gateway configured falls back to the logging sender,
   * which `ALLOW_SANDBOX_ADAPTERS` refuses in production - so a production
   * deployment that forgot to configure SMS reports nothing sent rather than
   * everything delivered.
   */
  SMS_GATEWAY_URL: z.string().url().optional(),
  EMAIL_GATEWAY_URL: z.string().url().optional(),
  PUSH_GATEWAY_URL: z.string().url().optional(),
  NOTIFICATION_GATEWAY_TOKEN: z.string().optional(),
  NOTIFICATION_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Attempts before a message is abandoned as FAILED. */
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  /** How long a claimed message stays invisible before another worker may take it. */
  NOTIFICATION_VISIBILITY_TIMEOUT_SECONDS: durationSeconds.default(300),
  /** Run the delivery sweep inside the API process. Off where a worker runs separately. */
  NOTIFICATION_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  NOTIFICATION_WORKER_INTERVAL_SECONDS: durationSeconds.default(30),
  NOTIFICATION_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),

  /**
   * Apply the retention schedule from inside the API process (§21, §68). Off
   * where a worker runs separately, and off by default - but note that off
   * everywhere means the schedule is not applied, which is the state this
   * platform was in for eleven phases. `docs/deployment.md` makes it a
   * go-live checklist item for that reason.
   */
  RETENTION_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Nightly. The periods are measured in days; an hourly sweep buys hours. */
  RETENTION_WORKER_INTERVAL_SECONDS: durationSeconds.default(86_400),
  /**
   * Rows one policy may erase in one sweep. The ceiling is the contracts
   * catalogue's; this is the deployment's choice below it, so a first run
   * against years of accumulated rows can be walked up rather than attempted
   * whole.
   */
  RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(5_000).default(1_000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${detail}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    if (env.ALLOW_SANDBOX_ADAPTERS) {
      throw new Error(
        'ALLOW_SANDBOX_ADAPTERS must be false in production: sandbox adapters must never serve production traffic.',
      );
    }
    if (env.DATABASE_SSL === 'disable') {
      throw new Error('DATABASE_SSL must not be "disable" in production.');
    }
  }
  if (env.TOKEN_SIGNING_KEY === env.SECRET_ENCRYPTION_KEY) {
    throw new Error('TOKEN_SIGNING_KEY and SECRET_ENCRYPTION_KEY must be different keys.');
  }
  return env;
}
