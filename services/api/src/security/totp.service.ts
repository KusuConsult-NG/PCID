import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface TotpVerification {
  readonly valid: boolean;
  /** The time step the code matched, so a replay of the same code can be refused. */
  readonly counter: number | null;
}

/**
 * Time-based one-time passwords, RFC 6238 (master system prompt §42).
 *
 * Implemented directly on the Node crypto primitives rather than pulled in as a
 * dependency: it is forty lines of well-specified arithmetic, and the platform's
 * second authentication factor should not be a transitive supply-chain risk.
 *
 * SHA-1 with a 30-second step and 6 digits, which is what the authenticator
 * applications officers already have actually implement.
 *
 * Replay is prevented by the caller: `verify` reports which time step matched,
 * and the credential store refuses a step at or below the last one used.
 */
@Injectable()
export class TotpService {
  static readonly STEP_SECONDS = 30;
  static readonly DIGITS = 6;
  /** One step either side, to tolerate clock drift on a field device. */
  static readonly WINDOW = 1;

  generateSecret(byteLength = 20): string {
    return base32Encode(randomBytes(byteLength));
  }

  /** The `otpauth://` URI an authenticator application scans. */
  provisioningUri(secret: string, accountName: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: String(TotpService.DIGITS),
      period: String(TotpService.STEP_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  generate(secret: string, atSeconds: number = Math.floor(Date.now() / 1000)): string {
    return this.codeForCounter(secret, Math.floor(atSeconds / TotpService.STEP_SECONDS));
  }

  verify(
    secret: string,
    code: string,
    options: { atSeconds?: number; lastUsedCounter?: number | null } = {},
  ): TotpVerification {
    const atSeconds = options.atSeconds ?? Math.floor(Date.now() / 1000);
    const normalized = code.replace(/\D/g, '');
    if (normalized.length !== TotpService.DIGITS) return { valid: false, counter: null };

    const current = Math.floor(atSeconds / TotpService.STEP_SECONDS);
    for (let offset = -TotpService.WINDOW; offset <= TotpService.WINDOW; offset += 1) {
      const counter = current + offset;
      if (counter < 0) continue;
      if (options.lastUsedCounter != null && counter <= options.lastUsedCounter) continue;
      const expected = this.codeForCounter(secret, counter);
      if (
        expected.length === normalized.length &&
        timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(normalized, 'utf8'))
      ) {
        return { valid: true, counter };
      }
    }
    return { valid: false, counter: null };
  }

  private codeForCounter(secret: string, counter: number): string {
    const key = base32Decode(secret);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', key).update(message).digest();
    const offset = (digest[digest.length - 1] as number) & 0x0f;
    const binary =
      (((digest[offset] as number) & 0x7f) << 24) |
      (((digest[offset + 1] as number) & 0xff) << 16) |
      (((digest[offset + 2] as number) & 0xff) << 8) |
      ((digest[offset + 3] as number) & 0xff);
    return String(binary % 10 ** TotpService.DIGITS).padStart(TotpService.DIGITS, '0');
  }
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 0b11111];
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 0b11111];
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** Single-use recovery codes for a lost authenticator. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(10)).slice(0, 16);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}
