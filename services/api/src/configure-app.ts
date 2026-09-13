import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { ENV } from './config/config.module';
import type { Env } from './config/env';

/**
 * Apply the platform's HTTP hardening.
 *
 * Kept in one place and applied by both the production entrypoint and the test
 * harness, so the suite exercises the headers and body limits the deployed
 * service actually serves rather than a bare Nest application that happens to
 * share its routes.
 */
export function configureApp(app: NestExpressApplication): Env {
  const env = app.get<Env>(ENV);

  // The platform runs behind a gateway (§45); trusting exactly one hop keeps
  // req.ip honest for audit and rate limiting without letting a client spoof it.
  app.set('trust proxy', 1);
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  // Deliberately no permissive CORS default: browser origins are allow-listed by
  // the gateway for the portals that need them.
  app.enableCors({ origin: false });

  // A citizen registration is a few kilobytes; nothing legitimate needs more.
  app.useBodyParser('json', { limit: '256kb' });

  return env;
}
