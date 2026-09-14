import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { Field, Select } from '@pcid/portal-kit/components';
import { SubmitButton } from '@pcid/portal-kit/components';
import { callApi, dataOr } from '@/lib/api';
import type { EmergencyContact } from '@/lib/types';

import { addContact, removeContact, updateContact } from './actions';

export const metadata: Metadata = { title: 'Emergency contacts' };

const PRIORITIES = [
  { value: '1', label: 'Call first' },
  { value: '2', label: 'Call second' },
  { value: '3', label: 'Call third' },
  { value: '4', label: 'Call fourth' },
  { value: '5', label: 'Call last' },
];

const MESSAGES: Record<string, { tone: 'ok' | 'danger'; title: string; body: string }> = {
  added: {
    tone: 'ok',
    title: 'Contact added',
    body: 'They will be called if you are in an emergency.',
  },
  updated: { tone: 'ok', title: 'Contact updated', body: 'The new details have been saved.' },
  removed: { tone: 'ok', title: 'Contact removed', body: 'They will no longer be called.' },
  missing: {
    tone: 'danger',
    title: 'Fill in the required boxes',
    body: 'A name, how you know them, and a phone number.',
  },
  failed: { tone: 'danger', title: 'That could not be saved', body: 'Please try again.' },
};

export default async function EmergencyContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const flagKey = ['added', 'updated', 'removed'].find((key) => params[key] === '1');
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const message = MESSAGES[flagKey ?? errorKey ?? ''];

  const contacts = dataOr(await callApi<EmergencyContact[]>('/api/v1/me/emergency-contacts'), []);

  return (
    <>
      <PageHeader
        title="Emergency contacts"
        lead="The people called if you are in an accident and cannot speak for yourself."
      />

      {message === undefined ? null : (
        <Notice tone={message.tone} title={message.title} live>
          {message.body}
        </Notice>
      )}

      <Notice title="Who can change these">
        <p style={{ marginBottom: 0 }}>
          These are yours to manage. A government officer can see them in an emergency, but every
          change records who made it — so if one is ever altered by anyone other than you, it shows.
        </p>
      </Notice>

      <section className="card" style={{ marginTop: '1.25rem' }} aria-labelledby="contacts-heading">
        <div className="card-header">
          <h2 id="contacts-heading">Your contacts</h2>
          <Badge tone={contacts.length === 0 ? 'warn' : 'ok'}>
            {contacts.length === 0 ? 'None saved' : `${contacts.length} saved`}
          </Badge>
        </div>

        {contacts.length === 0 ? (
          <Empty>You have not added anyone yet. Add at least one below.</Empty>
        ) : (
          <div className="stack">
            {contacts.map((contact) => (
              <details key={contact.id} className="card" style={{ boxShadow: 'none' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                  {contact.fullName} — {contact.relationship}{' '}
                  <span className="muted small">({contact.phonePrimary})</span>
                </summary>

                <form action={updateContact} noValidate style={{ marginTop: '1rem' }}>
                  <input type="hidden" name="contactId" value={contact.id} />
                  <Field
                    name="fullName"
                    id={`contact-${contact.id}-fullName`}
                    label="Full name"
                    defaultValue={contact.fullName}
                    required
                    maxLength={200}
                  />
                  <Field
                    name="relationship"
                    id={`contact-${contact.id}-relationship`}
                    label="How you know them"
                    defaultValue={contact.relationship}
                    required
                    maxLength={64}
                  />
                  <Field
                    name="phonePrimary"
                    id={`contact-${contact.id}-phonePrimary`}
                    label="Phone number"
                    type="tel"
                    inputMode="tel"
                    defaultValue={contact.phonePrimary}
                    required
                    maxLength={24}
                  />
                  <Field
                    name="phoneSecondary"
                    id={`contact-${contact.id}-phoneSecondary`}
                    label="Another number"
                    type="tel"
                    inputMode="tel"
                    defaultValue={contact.phoneSecondary ?? ''}
                    maxLength={24}
                  />
                  <Select
                    name="priority"
                    id={`contact-${contact.id}-priority`}
                    label="When to call them"
                    options={PRIORITIES}
                    defaultValue={String(contact.priority)}
                    required
                  />
                  <div className="actions">
                    <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
                  </div>
                </form>

                <form action={removeContact} style={{ marginTop: '1rem' }}>
                  <input type="hidden" name="contactId" value={contact.id} />
                  <SubmitButton className="button button-secondary" pendingLabel="Removing…">
                    Remove {contact.fullName}
                  </SubmitButton>
                </form>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="add-heading">
        <div className="card-header">
          <h2 id="add-heading">Add a contact</h2>
        </div>
        <form action={addContact} noValidate>
          <Field name="fullName" label="Full name" required maxLength={200} autoComplete="name" />
          <Field
            name="relationship"
            label="How you know them"
            hint="For example: mother, brother, neighbour, employer."
            required
            maxLength={64}
          />
          <Field
            name="phonePrimary"
            label="Phone number"
            type="tel"
            inputMode="tel"
            required
            maxLength={24}
            autoComplete="tel"
          />
          <Field
            name="phoneSecondary"
            label="Another number"
            type="tel"
            inputMode="tel"
            maxLength={24}
          />
          <Select
            name="priority"
            label="When to call them"
            options={PRIORITIES}
            defaultValue="1"
            required
          />
          <div className="actions">
            <SubmitButton pendingLabel="Adding…">Add contact</SubmitButton>
          </div>
        </form>
      </section>
    </>
  );
}
