import type { Action } from '@pcid/contracts';
import type { ZodTypeAny } from 'zod';

import { zodToJsonSchema } from './zod-to-schema';

export interface RouteParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required?: boolean;
  readonly description: string;
  readonly schema?: ZodTypeAny;
}

export interface RouteDocumentation {
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  readonly path: string;
  readonly tag: string;
  readonly summary: string;
  readonly description?: string;
  readonly parameters?: readonly RouteParameter[];
  readonly body?: ZodTypeAny;
  readonly responses?: Readonly<Record<string, string>>;
  readonly public?: boolean;
  readonly requiresStepUp?: boolean;
  /**
   * The authorisation action this route performs, where it performs one.
   *
   * Published in the contract so an integrator can see which entitlement a call
   * needs before making it, and asserted against the seeded roles in
   * `test/unit/action-coverage.test.ts`: an action a role grants but no route
   * performs is an entitlement nobody can exercise, which is how three of these
   * went unnoticed until the government portal needed them.
   *
   * Routes that perform several actions list them all. Routes that perform none
   * - signing in, a health probe - leave it undefined.
   */
  readonly actions?: readonly Action[];
}

const routes: RouteDocumentation[] = [];

/** Register a route in the published OpenAPI contract (§46). */
export function documentRoute(route: RouteDocumentation): RouteDocumentation {
  routes.push(route);
  return route;
}

export function registeredRoutes(): readonly RouteDocumentation[] {
  return routes;
}

export function buildOpenApiDocument(options: {
  version: string;
  serverUrl: string;
}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const operation: Record<string, unknown> = {
      tags: [route.tag],
      summary: route.summary,
      ...(route.description === undefined ? {} : { description: route.description }),
      security: route.public === true ? [] : [{ bearerAuth: [] }],
      ...(route.actions === undefined ? {} : { 'x-pcid-actions': [...route.actions] }),
      parameters: [
        ...(route.parameters ?? []).map((parameter) => ({
          name: parameter.name,
          in: parameter.in,
          required: parameter.required ?? parameter.in === 'path',
          description: parameter.description,
          schema: parameter.schema ? zodToJsonSchema(parameter.schema) : { type: 'string' },
        })),
        {
          name: 'x-correlation-id',
          in: 'header',
          required: false,
          description:
            'Client-supplied correlation id, echoed on the response and written to the audit record.',
          schema: { type: 'string' },
        },
      ],
      responses: {
        ...defaultResponses(route),
        ...Object.fromEntries(
          Object.entries(route.responses ?? {}).map(([status, description]) => [
            status,
            { description },
          ]),
        ),
      },
    };
    if (route.body !== undefined) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: zodToJsonSchema(route.body) } },
      };
    }
    paths[path] = { ...(paths[path] ?? {}), [route.method]: operation };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Plateau Citizen Identity & Data Exchange Platform (PCID)',
      version: options.version,
      description:
        'State identity and public-safety interoperability API. Every endpoint that touches ' +
        'citizen information requires an authenticated caller, a declared lawful purpose, and ' +
        'produces an immutable audit record. Denials do not distinguish "no such record" from ' +
        '"not permitted".',
    },
    servers: [{ url: options.serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'correlationId'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                correlationId: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { path: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

function defaultResponses(route: RouteDocumentation): Record<string, unknown> {
  const errorContent = {
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
  const responses: Record<string, unknown> = {
    '200': { description: 'Successful response.' },
    '400': { description: 'The request could not be accepted.', ...errorContent },
    '429': { description: 'Rate limited.', ...errorContent },
    '500': { description: 'Internal error.', ...errorContent },
  };
  if (route.public !== true) {
    responses['401'] = { description: 'Authentication is required.', ...errorContent };
    responses['403'] = {
      description:
        'Not authorised. The body names what is missing where it is safe to do so - a case reference, an approval, or a step-up.',
      ...errorContent,
    };
    responses['404'] = {
      description: 'The record does not exist or is not available to this account.',
      ...errorContent,
    };
  }
  if (route.requiresStepUp === true) {
    responses['403'] = {
      description: 'A freshly re-authenticated session is required for this operation.',
      ...errorContent,
    };
  }
  return responses;
}
