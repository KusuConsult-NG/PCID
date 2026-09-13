import { Injectable, PipeTransform } from '@nestjs/common';
import { ZodError } from 'zod';
import type { TypeOf, ZodTypeAny } from 'zod';

import { AppError } from './errors';

/**
 * Schema validation at the boundary (§45).
 *
 * Every request body, query and parameter object is parsed by an explicit schema
 * before a handler sees it. Unknown keys are stripped rather than passed through,
 * so a client cannot smuggle a field into a write path that a later refactor
 * starts honouring.
 */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, TypeOf<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): TypeOf<S> {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw AppError.validation(
          'The request could not be accepted.',
          error.issues.map((issue) => ({
            path: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        );
      }
      throw error;
    }
  }
}

/**
 * Parse `value` against `schema`, throwing a validation AppError on failure.
 *
 * Generic over the schema rather than its output type so that a schema with
 * defaults infers those fields as present, not optional.
 */
export function validate<S extends ZodTypeAny>(schema: S, value: unknown): TypeOf<S> {
  return new ZodValidationPipe(schema).transform(value);
}
