import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Envelope encryption for secrets the platform must be able to read back -
 * today, just TOTP seeds (§42).
 *
 * AES-256-GCM with a random IV per record and the version stamped into the
 * ciphertext, so a key rotation can decrypt old records while writing new ones
 * under the new key. The key itself comes from configuration and is expected to
 * be delivered by the deployment's secrets manager, never from the repository.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = decodeKey(env.SECRET_ENCRYPTION_KEY);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Unrecognised secret envelope');
    }
    const iv = Buffer.from(parts[1] as string, 'base64url');
    const tag = Buffer.from(parts[2] as string, 'base64url');
    const ciphertext = Buffer.from(parts[3] as string, 'base64url');
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new Error('Unrecognised secret envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

export function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64url');
  if (key.length < 32) {
    throw new Error('Key material must be at least 32 bytes');
  }
  return key.subarray(0, 32);
}

/** Constant-time comparison of two strings of arbitrary length. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Stable hash used for refresh tokens and API secrets held at rest. */
export function opaqueTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
