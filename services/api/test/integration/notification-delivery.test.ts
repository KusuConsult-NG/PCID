import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The queue, and the worker that drains it (§33, §58).
 *
 * Written around the property the whole design exists for: what a resident is
 * told in their portal and what is sent to their telephone are not the same
 * text, and the difference is not a formatting decision. The rest is the
 * ordinary robustness a queue needs — it claims exclusively, it backs off, it
 * gives up, and it never sends the same thing twice.
 */
describe('notification delivery', () => {
  let context: TestContext;
  let adminToken: string;
  let admin: ApiClient;
  let registrar: ApiClient;
  let officer: ApiClient;

  let pcid: string;
  let db: import('../../src/database/pool').Database;
  let notifications: import('../../src/notifications/notifications.service').NotificationsService;
  let worker: import('../../src/notifications/delivery.worker').NotificationDeliveryWorker;

  before(async () => {
    context = await createTestContext('notify');
    const bootstrap = await bootstrapAdmin(context);
    const session = await signIn(
      context,
      bootstrap.email,
      bootstrap.password,
      bootstrap.totpSecret,
    );
    adminToken = session.accessToken;
    admin = new ApiClient(context, adminToken);

    const registry = await createAgency(context, adminToken, {
      code: 'PLT-REGISTRY',
      name: 'Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const registrarUser = await createUser(context, adminToken, {
      email: 'registrar@notify.test',
      fullName: 'Registration Desk',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const dpoUser = await createUser(context, adminToken, {
      email: 'dpo@notify.test',
      fullName: 'Data Protection Office',
      agencyId: registry.id,
      roles: ['DATA_PROTECTION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });

    registrar = new ApiClient(
      context,
      (await signIn(context, registrarUser.email, registrarUser.password, registrarUser.totpSecret))
        .accessToken,
    );
    officer = new ApiClient(
      context,
      (await signIn(context, dpoUser.email, dpoUser.password, dpoUser.totpSecret)).accessToken,
    );

    const registered = await registrar
      .post('/api/v1/citizens', {
        givenName: 'Halima',
        familyName: 'Gyang',
        sex: 'FEMALE',
        dateOfBirth: '1991-04-22',
        phonePrimary: '08034440009',
        email: 'halima.gyang@example.test',
        residentialAddress: '3 Yakubu Gowon Way, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    pcid = (registered.body as { pcid: string }).pcid;

    const { Database } = await import('../../src/database/pool');
    const { NotificationsService } = await import('../../src/notifications/notifications.service');
    const { NotificationDeliveryWorker } = await import('../../src/notifications/delivery.worker');
    db = context.app.get(Database);
    notifications = context.app.get(NotificationsService);
    worker = context.app.get(NotificationDeliveryWorker);
    void admin;
  });

  after(async () => {
    await context.close();
  });

  test('the portal gets the detail and the telephone gets a notice', async () => {
    const detail =
      'Plateau State Police Command opened your record on 14 September under a criminal investigation.';

    const result = await notifications.enqueue({
      template: 'RECORD_ACCESSED',
      recipientType: 'CITIZEN',
      recipientId: pcid,
      subject: 'Your record was opened',
      detail,
      dedupeKey: `test-record-accessed:${pcid}`,
    });
    assert.equal(result.queued.length, 3, 'in-app, email and SMS');

    const rows = await db.query<{ channel: string; body: string; subject: string | null }>(
      `SELECT channel, body, subject FROM notification
        WHERE recipient_id = $1 AND template_key = 'RECORD_ACCESSED' ORDER BY channel`,
      [pcid],
    );

    const inApp = rows.find((row) => row.channel === 'IN_APP');
    assert.ok(inApp, 'the resident can read it in the portal');
    assert.equal(inApp.body, detail, 'behind authentication, they get the whole sentence');

    for (const external of rows.filter((row) => row.channel !== 'IN_APP')) {
      assert.notEqual(external.body, detail);
      // Not "roughly redacted": the body must be the catalogue's constant, and
      // must not contain the agency, the purpose or the date.
      assert.doesNotMatch(external.body, /Police|investigation|September/);
      assert.doesNotMatch(external.subject ?? '', /Police|investigation|September/);
      assert.match(external.body, /access history/);
    }
  });

  test('a resident with no telephone number is suppressed, not retried for ever', async () => {
    const registered = await registrar
      .post('/api/v1/citizens', {
        givenName: 'Musa',
        familyName: 'Dung',
        sex: 'MALE',
        dateOfBirth: '1975-01-09',
        residentialAddress: '8 Bauchi Road, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    const noPhone = (registered.body as { pcid: string }).pcid;

    const result = await notifications.enqueue({
      template: 'CREDENTIAL_ISSUED',
      recipientType: 'CITIZEN',
      recipientId: noPhone,
      subject: 'Your credential is ready',
      detail: 'Collect it from the registration desk.',
    });

    assert.ok(
      result.suppressed.some((entry) => entry.channel === 'SMS' && entry.reason === 'NO_ADDRESS'),
      'the SMS is suppressed because there is no number, and says so',
    );
    assert.ok(result.queued.some((entry) => entry.channel === 'IN_APP'));

    const suppressed = await db.queryOne<{ status: string; suppressed_reason: string }>(
      `SELECT status, suppressed_reason FROM notification
        WHERE recipient_id = $1 AND channel = 'SMS'`,
      [noPhone],
    );
    // Recorded rather than dropped: "nothing was sent, and here is why" is an
    // answer somebody will need.
    assert.equal(suppressed?.status, 'SUPPRESSED');
    assert.equal(suppressed?.suppressed_reason, 'NO_ADDRESS');
  });

  test('the same message is never queued twice', async () => {
    const input = {
      template: 'PORTAL_WELCOME' as const,
      recipientType: 'CITIZEN' as const,
      recipientId: pcid,
      subject: 'Your portal account is ready',
      detail: 'Choose your own passphrase and add an emergency contact.',
      dedupeKey: `test-welcome:${pcid}`,
    };
    const first = await notifications.enqueue(input);
    const second = await notifications.enqueue(input);

    assert.ok(first.queued.length > 0);
    assert.equal(second.queued.length, 0, 'the replay queues nothing');
    assert.ok(second.suppressed.every((entry) => entry.reason === 'DUPLICATE'));
  });

  test('a sweep delivers what is due and records an attempt for each', async () => {
    const before = await pending();
    assert.ok(before > 0, 'there is something to send');

    const result = await worker.sweep(100);
    assert.equal(result.claimed, before);
    assert.equal(result.sent, before, 'the sandbox sender reports every one sent');
    assert.equal(await pending(), 0);

    const attempts = await db.query<{ outcome: string; attempt: number }>(
      `SELECT a.outcome, a.attempt
         FROM notification_delivery_attempt a
         JOIN notification n ON n.id = a.notification_id
        WHERE n.recipient_id = $1`,
      [pcid],
    );
    assert.ok(attempts.length > 0, 'each delivery left a record of the attempt');
    assert.ok(attempts.every((row) => row.outcome === 'SENT' && row.attempt === 1));
  });

  test('a second sweep with nothing due does nothing', async () => {
    const result = await worker.sweep(100);
    assert.deepEqual(result, { claimed: 0, sent: 0, failed: 0, abandoned: 0 });
  });

  test('a failing message backs off, and then is abandoned rather than retried for ever', async () => {
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO notification
         (channel, recipient_type, recipient_id, recipient_address, subject, body,
          classification, template_key, status, next_attempt_at)
       VALUES ('SMS','CITIZEN',$1,'08034440009','notice','There is something waiting for you.',
               'INTERNAL','GENERAL','QUEUED', now())
       RETURNING id`,
      [pcid],
    );
    assert.ok(row);

    // A sender that always fails transiently, injected in place of the sandbox
    // one: this is the gateway having a very bad day.
    const failing = {
      channel: 'SMS' as const,
      mode: 'SANDBOX' as const,
      send: async () => ({ outcome: 'TRANSIENT_FAILURE' as const, detail: 'AbortError' }),
    };
    const senders = (worker as unknown as { senders: Map<string, unknown> }).senders;
    senders.set('SMS', failing);

    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        // Make it due again: the point of this test is the attempt counter and
        // the final state, not waiting out the real backoff.
        await db.query(`UPDATE notification SET next_attempt_at = now() WHERE id = $1`, [row.id]);
        await worker.sweep(10);
      }

      const state = await db.queryOne<{ status: string; attempts: number; last_error: string }>(
        'SELECT status, attempts, last_error FROM notification WHERE id = $1',
        [row.id],
      );
      assert.equal(state?.attempts, 5, 'five attempts, which is the configured ceiling');
      assert.equal(state?.status, 'FAILED', 'and then it stops');
      assert.equal(state?.last_error, 'AbortError');

      const attempts = await db.query<{ attempt: number; outcome: string }>(
        'SELECT attempt, outcome FROM notification_delivery_attempt WHERE notification_id = $1 ORDER BY attempt',
        [row.id],
      );
      assert.equal(attempts.length, 5, 'every attempt is on the record, not just the last');
      assert.ok(attempts.every((entry) => entry.outcome === 'FAILED'));
    } finally {
      senders.delete('SMS');
    }
  });

  test('a gateway that rejects the destination is not retried at all', async () => {
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO notification
         (channel, recipient_type, recipient_id, recipient_address, subject, body,
          classification, template_key, status, next_attempt_at)
       VALUES ('SMS','CITIZEN',$1,'not-a-number','notice','There is something waiting for you.',
               'INTERNAL','GENERAL','QUEUED', now())
       RETURNING id`,
      [pcid],
    );
    assert.ok(row);

    const senders = (worker as unknown as { senders: Map<string, unknown> }).senders;
    senders.set('SMS', {
      channel: 'SMS' as const,
      mode: 'SANDBOX' as const,
      send: async () => ({
        outcome: 'PERMANENT_FAILURE' as const,
        detail: 'gateway rejected: 400',
      }),
    });

    try {
      await worker.sweep(10);
      const state = await db.queryOne<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM notification WHERE id = $1',
        [row.id],
      );
      // One attempt, then done. Forty identical rejections tell an operator
      // nothing they did not know after the first.
      assert.equal(state?.attempts, 1);
      assert.equal(state?.status, 'FAILED');
    } finally {
      senders.delete('SMS');
    }
  });

  test('the queue view answers an operator and discloses nobody’s post', async () => {
    const response = await admin.get('/api/v1/notifications/queue').expect(200);
    const body = response.body as {
      counts: { channel: string; status: string; count: number }[];
      abandoned: { id: string; template: string; attempts: number }[];
      oldestWaitingAt: string | null;
    };

    assert.ok(body.counts.length > 0);
    assert.ok(body.abandoned.length >= 2, 'the abandoned messages are listed');

    // Not one recipient, address, subject or body anywhere in the response.
    const serialised = JSON.stringify(body);
    assert.doesNotMatch(serialised, /08034440009|halima|There is something waiting/i);
    assert.ok(body.abandoned.every((entry) => entry.template === 'GENERAL'));
  });

  test('an operator can put an abandoned message back, and must say why', async () => {
    const failed = await db.queryOne<{ id: string }>(
      "SELECT id FROM notification WHERE status = 'FAILED' LIMIT 1",
    );
    assert.ok(failed);

    await admin.post(`/api/v1/notifications/${failed.id}/retry`, { note: 'no' }).expect(400);

    const retried = await admin
      .post(`/api/v1/notifications/${failed.id}/retry`, {
        note: 'The SMS gateway certificate had expired and has been replaced.',
      })
      .expect(201);
    assert.equal((retried.body as { status: string }).status, 'QUEUED');

    const state = await db.queryOne<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM notification WHERE id = $1',
      [failed.id],
    );
    assert.equal(state?.status, 'QUEUED');
    assert.equal(state?.attempts, 0);
  });

  test('the queue is administration, and carries no entitlement to citizen data', async () => {
    // A Data Protection Officer holds oversight of the register and no technical
    // administration at all: the separation runs both ways (§7).
    await officer.get('/api/v1/notifications/queue').expect(404);
    await officer.post('/api/v1/notifications/sweep').expect(404);
  });

  async function pending(): Promise<number> {
    const row = await db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM notification
        WHERE status IN ('QUEUED','SENDING') AND next_attempt_at <= now()`,
    );
    return Number(row?.count ?? 0);
  }
});
