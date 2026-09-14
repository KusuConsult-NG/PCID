import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  EXTERNAL_CHANNELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_TEMPLATE_DEFINITIONS,
  channelsFor,
  isExternalChannel,
  notificationTemplate,
} from '@pcid/contracts';

import { backoffSeconds } from '../../src/notifications/delivery.worker';
import { NotificationsService } from '../../src/notifications/notifications.service';

/**
 * The rule the whole notification design rests on:
 *
 * **a message sent outside the platform carries a notice, never the thing it is
 * about.**
 *
 * That rule lives in a catalogue of constants, and a catalogue of constants is
 * exactly the kind of thing somebody edits in a hurry. These tests are what
 * stops the edit that puts a name in an SMS.
 */
describe('notification templates', () => {
  test('every template is defined exactly once, and every definition is a template', () => {
    const defined = NOTIFICATION_TEMPLATE_DEFINITIONS.map((entry) => entry.key).sort();
    assert.deepEqual(defined, [...NOTIFICATION_TEMPLATES].sort());
    assert.equal(new Set(defined).size, defined.length, 'no template is defined twice');
  });

  test('a notice carries no placeholder, because a placeholder is where a name goes', () => {
    // The single most likely way this design is undone is somebody writing
    // "Hello ${name}," into a notice. Every interpolation syntax anybody would
    // reach for is refused.
    const offenders = NOTIFICATION_TEMPLATE_DEFINITIONS.filter((entry) =>
      /\$\{|\{\{|%s|\{[a-zA-Z]/.test(entry.notice),
    ).map((entry) => entry.key);

    assert.deepEqual(
      offenders,
      [],
      `these notices interpolate something, and a notice must be a constant: ${offenders.join(', ')}`,
    );
  });

  test('a notice never carries a reference, an identifier or a field name', () => {
    // A case number or a PCID in an SMS is still a disclosure, even without a
    // name attached: it says this person is involved in something.
    const offenders = NOTIFICATION_TEMPLATE_DEFINITIONS.filter((entry) =>
      /\bPL-|\bCASE-|\bINC-|\bUP-|\bAR-|citizen\.|\bpcid\b/i.test(entry.notice),
    ).map((entry) => entry.key);

    assert.deepEqual(
      offenders,
      [],
      `references must not appear in a notice: ${offenders.join(', ')}`,
    );
  });

  test('a notice is short enough to be a single SMS and to read on a lock screen', () => {
    for (const entry of NOTIFICATION_TEMPLATE_DEFINITIONS) {
      assert.ok(
        entry.notice.length <= 160,
        `${entry.key}: a notice of ${entry.notice.length} characters is more than one message`,
      );
      assert.ok(entry.notice.length >= 10, `${entry.key}: a notice has to say something`);
    }
  });

  test('the passphrase template never offers to send the passphrase', () => {
    // An account passphrase is handed over in person. There is no channel on
    // which the platform sends one, and the notice says so rather than being
    // silent about it.
    const notice = notificationTemplate('ACCOUNT_PASSPHRASE_ISSUED').notice;
    assert.match(notice, /in person/, 'the notice says where the passphrase actually comes from');
    // Nothing that introduces a value. The placeholder test above catches an
    // interpolation; this catches a literal one somebody pasted in.
    assert.doesNotMatch(notice, /passphrase\s*(is|:)\s*['"“]?[A-Za-z0-9]{6,}/i);
  });

  test('every template declares at least one channel, and every channel is real', () => {
    for (const entry of NOTIFICATION_TEMPLATE_DEFINITIONS) {
      assert.ok(entry.channels.length > 0, `${entry.key} can be delivered nowhere`);
      for (const channel of entry.channels) {
        assert.ok(
          (NOTIFICATION_CHANNELS as readonly string[]).includes(channel),
          `${entry.key} names a channel that does not exist: ${channel}`,
        );
      }
    }
  });

  test('anything that goes out externally can also be read in the portal', () => {
    // Otherwise a resident receives "there is something waiting for you" and
    // has nowhere to go and read it, which is worse than not telling them.
    for (const entry of NOTIFICATION_TEMPLATE_DEFINITIONS) {
      if (!entry.channels.some(isExternalChannel)) continue;
      assert.ok(
        entry.channels.includes('IN_APP'),
        `${entry.key} goes out externally but is not readable in the portal`,
      );
    }
  });

  test('the external channels are the ones that leave the platform', () => {
    assert.deepEqual([...EXTERNAL_CHANNELS].sort(), ['EMAIL', 'PUSH', 'SMS']);
    for (const channel of NOTIFICATION_CHANNELS) {
      assert.equal(
        isExternalChannel(channel),
        ['EMAIL', 'PUSH', 'SMS'].includes(channel),
        `${channel} is on the wrong side of the boundary`,
      );
    }
  });

  test('channelsFor is the template’s own list and nothing wider', () => {
    for (const key of NOTIFICATION_TEMPLATES) {
      assert.deepEqual([...channelsFor(key)], [...notificationTemplate(key).channels]);
    }
  });

  test('an unknown template is refused rather than silently defaulted', () => {
    assert.throws(
      () => notificationTemplate('NOT_A_TEMPLATE' as never),
      /No notification template/,
    );
  });
});

describe('what a channel may carry', () => {
  test('no external channel ever carries the detail, at any classification', () => {
    for (const channel of EXTERNAL_CHANNELS) {
      for (const classification of ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SENSITIVE'] as const) {
        assert.equal(
          NotificationsService.carriesDetail(channel, classification),
          false,
          `${channel} must never carry the detail, and would have for ${classification}`,
        );
      }
    }
  });

  test('the portal carries the detail', () => {
    assert.equal(NotificationsService.carriesDetail('IN_APP', 'SENSITIVE'), true);
    assert.equal(NotificationsService.carriesDetail('DASHBOARD', 'CONFIDENTIAL'), true);
  });

  test('not even the portal carries law-enforcement material in a message', () => {
    // A notification is a convenience surface. Material at that classification
    // is reached through the routes that check the compartment, not through an
    // inbox that only checks who you are.
    assert.equal(NotificationsService.carriesDetail('IN_APP', 'LAW_ENFORCEMENT_RESTRICTED'), false);
  });
});

describe('delivery backoff', () => {
  test('it grows, and then it stops growing', () => {
    assert.equal(backoffSeconds(1), 30);
    assert.equal(backoffSeconds(2), 120);
    assert.equal(backoffSeconds(3), 480);
    // Capped at half an hour: a gateway that has been down that long does not
    // need a worker hammering it, and a message that late is already late.
    assert.equal(backoffSeconds(4), 1800);
    assert.equal(backoffSeconds(50), 1800);
  });

  test('it never returns zero, so a failing message never spins', () => {
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      assert.ok(backoffSeconds(attempt) >= 30, `attempt ${attempt} would retry immediately`);
    }
  });
});
