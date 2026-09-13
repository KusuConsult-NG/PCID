import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  CryptoService,
  constantTimeEquals,
  newOpaqueToken,
  opaqueTokenHash,
} from '../../src/security/crypto.service';
import { PasswordService, validatePasswordStrength } from '../../src/security/password.service';
import { TokenService } from '../../src/security/token.service';
import {
  TotpService,
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
} from '../../src/security/totp.service';
import type { Env } from '../../src/config/env';

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgres://localhost/none',
    DATABASE_POOL_MAX: 5,
    DATABASE_STATEMENT_TIMEOUT_MS: 1000,
    DATABASE_SSL: 'disable',
    TOKEN_SIGNING_KEY: randomBytes(32).toString('base64url'),
    SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 3600,
    AAL2_TTL_SECONDS: 600,
    LOGIN_MAX_FAILURES: 5,
    LOGIN_LOCKOUT_SECONDS: 900,
    RATE_LIMIT_WINDOW_SECONDS: 60,
    RATE_LIMIT_DEFAULT_MAX: 120,
    RATE_LIMIT_SEARCH_MAX: 20,
    SEARCH_VOLUME_ALERT_THRESHOLD: 60,
    SEARCH_VOLUME_WINDOW_SECONDS: 3600,
    STATE_TIMEZONE: 'Africa/Lagos',
    PLATFORM_BASE_URL: 'http://localhost:3000',
    VERIFICATION_BASE_URL: 'http://localhost:3000/verify',
    ALLOW_SANDBOX_ADAPTERS: true,
    ...overrides,
  } as Env;
}

describe('password storage (§42)', () => {
  const passwords = new PasswordService();

  test('a hash verifies and a wrong password does not', async () => {
    const stored = await passwords.hash('a-correct-horse-battery-staple');
    assert.equal(await passwords.verify('a-correct-horse-battery-staple', stored), true);
    assert.equal(await passwords.verify('a-correct-horse-battery-stapl', stored), false);
  });

  test('the same password produces different hashes, so the salt is per record', async () => {
    const first = await passwords.hash('a-correct-horse-battery-staple');
    const second = await passwords.hash('a-correct-horse-battery-staple');
    assert.notEqual(first.hash, second.hash);
    assert.equal(await passwords.verify('a-correct-horse-battery-staple', second), true);
  });

  test('verifying against no stored record still returns false without throwing', async () => {
    assert.equal(await passwords.verify('anything at all', null), false);
  });

  test('the stored parameters travel with the hash so they can be raised later', async () => {
    const stored = await passwords.hash('a-correct-horse-battery-staple');
    assert.equal(stored.algorithm, 'scrypt');
    assert.ok(stored.params.N >= 32_768);
    assert.equal(passwords.needsRehash(stored), false);
    assert.equal(
      passwords.needsRehash({ algorithm: 'scrypt', params: { N: 1024, r: 8, p: 1 } }),
      true,
      'a hash made with weaker parameters is flagged for rehash on next login',
    );
    assert.equal(passwords.needsRehash({ algorithm: 'md5', params: {} }), true);
  });

  test('unicode passwords are normalised so the same typed phrase always verifies', async () => {
    const composed = 'Passé-phrase-for-testing';
    const decomposed = 'Passé-phrase-for-testing';
    const stored = await passwords.hash(composed);
    assert.equal(await passwords.verify(decomposed, stored), true);
  });

  test('the password policy rejects short, repetitive and self-referential passphrases', () => {
    assert.ok(validatePasswordStrength('short').length > 0);
    assert.ok(validatePasswordStrength('aaaaaaaaaaaaaaaaaa').length > 0);
    // The check works on the parts of the supplied context, so a surname is
    // caught even though the full email address never appears in the password.
    assert.ok(
      validatePasswordStrength('Amina-Dung-Passphrase-1', ['amina.dung@example.ng']).some(
        (problem) => problem.includes('your name'),
      ),
    );
    assert.ok(
      validatePasswordStrength('Correct-Horse-Dung-Battery-7', ['Amina Dung']).some((problem) =>
        problem.includes('your name'),
      ),
    );
    assert.deepEqual(validatePasswordStrength('Correct-Horse-Battery-7'), []);
    assert.deepEqual(
      validatePasswordStrength('Correct-Horse-Battery-7', ['amina.dung@example.ng']),
      [],
    );
  });
});

describe('TOTP (§42)', () => {
  const totp = new TotpService();

  test('base32 round-trips', () => {
    for (let i = 0; i < 100; i += 1) {
      const bytes = randomBytes(1 + (i % 20));
      assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
    }
  });

  test('a generated code verifies within the window and not outside it', () => {
    const secret = totp.generateSecret();
    const now = 1_800_000_000;
    const code = totp.generate(secret, now);
    assert.equal(totp.verify(secret, code, { atSeconds: now }).valid, true);
    assert.equal(
      totp.verify(secret, code, { atSeconds: now + 30 }).valid,
      true,
      'one step of drift is tolerated',
    );
    assert.equal(totp.verify(secret, code, { atSeconds: now - 30 }).valid, true);
    assert.equal(totp.verify(secret, code, { atSeconds: now + 120 }).valid, false);
  });

  test('a code cannot be replayed once its time step has been used', () => {
    const secret = totp.generateSecret();
    const now = 1_800_000_000;
    const code = totp.generate(secret, now);
    const first = totp.verify(secret, code, { atSeconds: now });
    assert.equal(first.valid, true);
    assert.ok(first.counter !== null);
    const replay = totp.verify(secret, code, { atSeconds: now, lastUsedCounter: first.counter });
    assert.equal(replay.valid, false, 'the same code must not verify twice');
  });

  test('a wrong code and a malformed code are both rejected', () => {
    const secret = totp.generateSecret();
    const now = 1_800_000_000;
    const correct = totp.generate(secret, now);
    const wrong = String((Number(correct) + 1) % 1_000_000).padStart(6, '0');
    assert.equal(totp.verify(secret, wrong, { atSeconds: now }).valid, false);
    assert.equal(totp.verify(secret, 'abcdef').valid, false);
    assert.equal(totp.verify(secret, '12345').valid, false);
    assert.equal(totp.verify(secret, '').valid, false);
  });

  test('the provisioning URI is a well-formed otpauth link', () => {
    const secret = totp.generateSecret();
    const uri = totp.provisioningUri(secret, 'officer@example.gov.ng', 'PCID Plateau State');
    assert.ok(uri.startsWith('otpauth://totp/'));
    assert.ok(uri.includes(`secret=${secret}`));
    assert.ok(uri.includes('digits=6'));
    assert.ok(uri.includes('period=30'));
  });

  test('recovery codes are unique and formatted for reading aloud', () => {
    const codes = generateRecoveryCodes(20);
    assert.equal(new Set(codes).size, 20);
    for (const code of codes) {
      assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });
});

describe('access tokens (§42)', () => {
  const env = testEnv();
  const tokens = new TokenService(env);

  test('an issued token verifies and carries the expected claims', () => {
    const issued = tokens.issue({
      subject: 'usr-1',
      sessionId: 'ses-1',
      actorType: 'GOVERNMENT_USER',
      authenticationLevel: 'AAL2',
      jti: 'jti-1',
    });
    const claims = tokens.verify(issued.token);
    assert.ok(claims);
    assert.equal(claims?.sub, 'usr-1');
    assert.equal(claims?.sid, 'ses-1');
    assert.equal(claims?.aal, 'AAL2');
  });

  test('a token signed with another key is rejected', () => {
    const other = new TokenService(testEnv());
    const issued = other.issue({
      subject: 'usr-1',
      sessionId: 'ses-1',
      actorType: 'GOVERNMENT_USER',
      authenticationLevel: 'AAL2',
      jti: 'jti-1',
    });
    assert.equal(tokens.verify(issued.token), null);
  });

  test('the "none" algorithm and any other algorithm header are rejected', () => {
    const issued = tokens.issue({
      subject: 'usr-1',
      sessionId: 'ses-1',
      actorType: 'GOVERNMENT_USER',
      authenticationLevel: 'AAL1',
      jti: 'jti-1',
    });
    const [, payload] = issued.token.split('.');
    for (const algorithm of ['none', 'HS512', 'RS256']) {
      const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString(
        'base64url',
      );
      assert.equal(
        tokens.verify(`${header}.${payload}.`),
        null,
        `${algorithm} must not be accepted`,
      );
      assert.equal(tokens.verify(`${header}.${payload}.abc`), null);
    }
  });

  test('a tampered payload is rejected', () => {
    const issued = tokens.issue({
      subject: 'usr-1',
      sessionId: 'ses-1',
      actorType: 'GOVERNMENT_USER',
      authenticationLevel: 'AAL1',
      jti: 'jti-1',
    });
    const [header, payload, signature] = issued.token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    claims.aal = 'AAL2';
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
    assert.equal(tokens.verify(`${header}.${forged}.${signature}`), null);
  });

  test('an expired token is rejected', () => {
    const issued = tokens.issue({
      subject: 'usr-1',
      sessionId: 'ses-1',
      actorType: 'GOVERNMENT_USER',
      authenticationLevel: 'AAL1',
      jti: 'jti-1',
      nowSeconds: 1_000_000,
    });
    assert.notEqual(
      tokens.verify(issued.token, 1_000_000 + 10),
      null,
      'still valid inside its lifetime',
    );
    assert.equal(tokens.verify(issued.token, 1_000_000 + 100_000), null, 'refused once expired');
  });

  test('malformed tokens are rejected rather than throwing', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', '...', 'not-a-token']) {
      assert.equal(tokens.verify(bad), null);
    }
  });
});

describe('secret encryption at rest (§42)', () => {
  const env = testEnv();
  const crypto = new CryptoService(env);

  test('ciphertext round-trips and is different every time', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const first = crypto.encrypt(plaintext);
    const second = crypto.encrypt(plaintext);
    assert.notEqual(first, second, 'a fresh IV per record');
    assert.equal(crypto.decrypt(first), plaintext);
    assert.equal(crypto.decrypt(second), plaintext);
  });

  test('a tampered ciphertext is rejected by the authentication tag', () => {
    const envelope = crypto.encrypt('JBSWY3DPEHPK3PXP');
    const parts = envelope.split('.');
    const bytes = Buffer.from(parts[3] as string, 'base64url');
    bytes[0] = (bytes[0] as number) ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], bytes.toString('base64url')].join('.');
    assert.throws(() => crypto.decrypt(tampered));
  });

  test('a ciphertext from another key does not decrypt', () => {
    const other = new CryptoService(testEnv());
    assert.throws(() => crypto.decrypt(other.encrypt('JBSWY3DPEHPK3PXP')));
  });

  test('opaque tokens are unguessable and stored only as a hash', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i += 1) tokens.add(newOpaqueToken());
    assert.equal(tokens.size, 1000);
    const token = newOpaqueToken();
    const hash = opaqueTokenHash(token);
    assert.equal(hash.length, 64);
    assert.notEqual(hash, token);
    assert.equal(opaqueTokenHash(token), hash);
  });

  test('constant-time comparison agrees with equality', () => {
    assert.equal(constantTimeEquals('abc', 'abc'), true);
    assert.equal(constantTimeEquals('abc', 'abd'), false);
    assert.equal(constantTimeEquals('abc', 'abcd'), false);
  });
});

describe('configuration safety (§77)', () => {
  test('production refuses sandbox adapters and an unencrypted database connection', async () => {
    const { loadEnv } = await import('../../src/config/env');
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost/pcid',
      DATABASE_SSL: 'verify-full',
      TOKEN_SIGNING_KEY: randomBytes(32).toString('base64url'),
      SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      ALLOW_SANDBOX_ADAPTERS: 'false',
    } as NodeJS.ProcessEnv;

    assert.doesNotThrow(() => loadEnv(base));
    assert.throws(
      () => loadEnv({ ...base, ALLOW_SANDBOX_ADAPTERS: 'true' }),
      /sandbox adapters must never serve production traffic/,
    );
    assert.throws(() => loadEnv({ ...base, DATABASE_SSL: 'disable' }), /DATABASE_SSL/);
  });

  test('the signing key and the secret encryption key must differ', async () => {
    const { loadEnv } = await import('../../src/config/env');
    const shared = randomBytes(32).toString('base64url');
    assert.throws(
      () =>
        loadEnv({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgres://localhost/pcid',
          TOKEN_SIGNING_KEY: shared,
          SECRET_ENCRYPTION_KEY: shared,
        } as NodeJS.ProcessEnv),
      /must be different keys/,
    );
  });

  test('short key material is refused', async () => {
    const { loadEnv } = await import('../../src/config/env');
    assert.throws(
      () =>
        loadEnv({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgres://localhost/pcid',
          TOKEN_SIGNING_KEY: 'too-short',
          SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
        } as NodeJS.ProcessEnv),
      /TOKEN_SIGNING_KEY/,
    );
  });
});
