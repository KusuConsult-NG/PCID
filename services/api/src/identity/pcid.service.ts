import { Injectable } from '@nestjs/common';
import { generatePcid, isValidPcid, parsePcid } from '@pcid/contracts';

import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import type { QueryRunner } from '../database/pool';
import { Database } from '../database/pool';

/**
 * PCID allocation (master system prompt §49).
 *
 * A candidate is drawn from the cryptographic random source and offered to the
 * database, which holds the uniqueness constraint. On the vanishingly rare
 * collision the service simply draws again: uniqueness is the database's to
 * guarantee, not the generator's to assume.
 *
 * Allocation is recorded in the append-only `pcid_allocation` table before the
 * citizen row exists, so an identifier that was ever handed out - even for a
 * registration later rejected - can never be handed out again.
 */
@Injectable()
export class PcidService {
  private static readonly MAX_ATTEMPTS = 8;

  constructor(private readonly db: Database) {}

  async allocate(
    runner: QueryRunner,
    options: { channel: string; allocatedBy?: string | null },
  ): Promise<string> {
    for (let attempt = 1; attempt <= PcidService.MAX_ATTEMPTS; attempt += 1) {
      const candidate = generatePcid();
      try {
        await runner.query(
          'INSERT INTO pcid_allocation (pcid, channel, allocated_by) VALUES ($1, $2, $3)',
          [candidate, options.channel, options.allocatedBy ?? null],
        );
        return candidate;
      } catch (error) {
        if (isUniqueViolation(error)) {
          logger.warn('pcid_collision_retried', { attempt });
          continue;
        }
        throw error;
      }
    }
    throw new AppError('INTERNAL_ERROR', 'A Plateau Citizen ID could not be allocated.', {
      internalReason: `no free PCID after ${PcidService.MAX_ATTEMPTS} attempts`,
    });
  }

  /** Normalise user input to canonical form, rejecting anything that fails the check pair. */
  parse(input: string): string {
    const parsed = parsePcid(input);
    if (parsed === null) {
      throw AppError.validation('That is not a valid Plateau Citizen ID.', [
        { path: 'pcid', message: 'Expected the form PL-XXXXX-XXXXX-XX.' },
      ]);
    }
    return parsed;
  }

  isValid(input: string): boolean {
    return isValidPcid(input);
  }

  async wasEverAllocated(pcid: string): Promise<boolean> {
    const row = await this.db.queryOne<{ pcid: string }>(
      'SELECT pcid FROM pcid_allocation WHERE pcid = $1',
      [pcid],
    );
    return row !== null;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
