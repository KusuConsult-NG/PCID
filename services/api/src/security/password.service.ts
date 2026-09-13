import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export type PasswordParameters = {
  readonly N: number;
  readonly r: number;
  readonly p: number;
};

export type StoredPassword = {
  readonly algorithm: string;
  readonly params: PasswordParameters & { readonly saltLength: number; readonly keyLength: number };
  readonly hash: string;
};

/**
 * Password storage (master system prompt §42).
 *
 * scrypt from the Node runtime, at parameters that cost roughly 100ms per
 * verification on server hardware. The parameters travel with the hash so they
 * can be raised over time and re-applied per user on their next successful
 * login, without a flag day.
 *
 * Verification is constant-time and always performs the full derivation, so an
 * attacker cannot distinguish "no such account" from "wrong password" by timing.
 */
@Injectable()
export class PasswordService {
  static readonly ALGORITHM = 'scrypt';
  static readonly CURRENT_PARAMS: PasswordParameters = { N: 32_768, r: 8, p: 1 };
  private static readonly SALT_LENGTH = 16;
  private static readonly KEY_LENGTH = 32;
  private static readonly MAX_MEM = 128 * 32_768 * 8 * 2;

  /** A hash of a value nobody knows, used to keep timing uniform for unknown accounts. */
  private readonly decoyHash = this.hashSync();

  async hash(password: string): Promise<StoredPassword> {
    const salt = randomBytes(PasswordService.SALT_LENGTH);
    const derived = await scryptAsync(
      password.normalize('NFKC'),
      salt,
      PasswordService.KEY_LENGTH,
      { ...PasswordService.CURRENT_PARAMS, maxmem: PasswordService.MAX_MEM },
    );
    return {
      algorithm: PasswordService.ALGORITHM,
      params: {
        ...PasswordService.CURRENT_PARAMS,
        saltLength: PasswordService.SALT_LENGTH,
        keyLength: PasswordService.KEY_LENGTH,
      },
      hash: `${salt.toString('base64')}$${derived.toString('base64')}`,
    };
  }

  async verify(
    password: string,
    stored: { hash: string; algorithm: string; params: Readonly<Record<string, unknown>> } | null,
  ): Promise<boolean> {
    const target = stored ?? this.decoyHash;
    if (target.algorithm !== PasswordService.ALGORITHM) return false;

    const [saltPart, hashPart] = target.hash.split('$');
    if (saltPart === undefined || hashPart === undefined) return false;

    const N = numberOr(target.params.N, PasswordService.CURRENT_PARAMS.N);
    const r = numberOr(target.params.r, PasswordService.CURRENT_PARAMS.r);
    const p = numberOr(target.params.p, PasswordService.CURRENT_PARAMS.p);
    const expected = Buffer.from(hashPart, 'base64');

    let derived: Buffer;
    try {
      derived = await scryptAsync(
        password.normalize('NFKC'),
        Buffer.from(saltPart, 'base64'),
        expected.length,
        { N, r, p, maxmem: PasswordService.MAX_MEM },
      );
    } catch {
      return false;
    }
    const matches = derived.length === expected.length && timingSafeEqual(derived, expected);
    // A caller with no stored record still paid the full derivation cost, and
    // still gets false.
    return stored !== null && matches;
  }

  /** True when the stored hash was produced with weaker parameters than current. */
  needsRehash(stored: { algorithm: string; params: Readonly<Record<string, unknown>> }): boolean {
    if (stored.algorithm !== PasswordService.ALGORITHM) return true;
    return (
      numberOr(stored.params.N, 0) < PasswordService.CURRENT_PARAMS.N ||
      numberOr(stored.params.r, 0) < PasswordService.CURRENT_PARAMS.r ||
      numberOr(stored.params.p, 0) < PasswordService.CURRENT_PARAMS.p
    );
  }

  private hashSync(): { hash: string; algorithm: string; params: Record<string, unknown> } {
    const salt = randomBytes(PasswordService.SALT_LENGTH);
    return {
      algorithm: PasswordService.ALGORITHM,
      params: { ...PasswordService.CURRENT_PARAMS },
      hash: `${salt.toString('base64')}$${randomBytes(PasswordService.KEY_LENGTH).toString('base64')}`,
    };
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Password policy for government users. Length is the dominant factor, so the
 * floor is high and composition rules are kept minimal - they push people toward
 * predictable substitutions without adding real strength.
 */
export function validatePasswordStrength(
  password: string,
  context: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  if (password.length < 14) problems.push('Use at least 14 characters.');
  if (password.length > 256) problems.push('Use at most 256 characters.');
  if (!/[a-z]/u.test(password) || !/[A-Z]/u.test(password)) {
    problems.push('Use both upper and lower case letters.');
  }
  if (!/\d/u.test(password)) problems.push('Include at least one digit.');
  const lowered = password.toLowerCase();
  // Compare against the *parts* of the supplied context, not the whole string: a
  // password containing someone's surname would otherwise sail past a check that
  // only looks for their full email address.
  const tokens = new Set<string>();
  for (const value of context) {
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/u)) {
      if (token.length >= 4) tokens.add(token);
    }
  }
  for (const token of tokens) {
    if (lowered.includes(token)) {
      problems.push('Do not include your name, email address or service number.');
      break;
    }
  }
  if (/^(.)\1+$/u.test(password)) problems.push('Do not repeat a single character.');
  return problems;
}
