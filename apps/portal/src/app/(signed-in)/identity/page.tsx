import { KeepCardOffline } from '@/components/offline';
import type { Metadata } from 'next';
import QRCode from 'qrcode';

import { PageHeader } from '@/components/chrome';
import { Badge, Notice } from '@pcid/portal-kit/components';
import { TextArea } from '@pcid/portal-kit/components';
import { SubmitButton } from '@pcid/portal-kit/components';
import { callApi, dataOr } from '@/lib/api';
import { formatDate, formatDateTime, relativeMinutes, sentenceCase } from '@pcid/portal-kit/format';
import type { CitizenRecord, Credential, VerificationHistory } from '@/lib/types';

import { reportCredentialLost } from './actions';

export const metadata: Metadata = { title: 'My Plateau Citizen ID' };

export default async function IdentityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const [recordResult, credentialResult, historyResult] = await Promise.all([
    callApi<CitizenRecord>('/api/v1/me/record'),
    callApi<Credential>('/api/v1/me/credential'),
    callApi<VerificationHistory>('/api/v1/me/verification-history?limit=10'),
  ]);

  const record = dataOr(recordResult, null);
  const credential = dataOr(credentialResult, null);
  const history = dataOr(historyResult, null);

  const identity = record?.cards.find((card) => card.key === 'IDENTITY');
  const item = identity?.status === 'RELEASED' ? (identity.items?.[0] ?? {}) : {};

  const qrSvg =
    credential === null || !credential.usable
      ? null
      : await QRCode.toString(credential.verificationUrl, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 0,
        });

  return (
    <>
      <PageHeader
        title="My Plateau Citizen ID"
        lead="Your ID is yours for life. The card and the code below can be replaced if you lose them."
      />

      {params.reported === '1' ? (
        <Notice tone="ok" title="Thank you — that credential has been cancelled" live>
          <p>
            Anyone who scans the old code will be told it is no longer valid. A new one has been
            issued below. Your Plateau Citizen ID has not changed.
          </p>
        </Notice>
      ) : null}

      <div className="grid">
        <section className="card" aria-labelledby="credential-heading">
          <div className="card-header">
            <h2 id="credential-heading">Your credential</h2>
            {credential === null ? null : (
              <Badge tone={credential.usable ? 'ok' : 'danger'}>
                {credential.usable ? 'Valid' : 'Not valid'}
              </Badge>
            )}
          </div>

          <div className="credential">
            <p className="credential-label">Government of Plateau State</p>
            <p className="credential-name">{String(item.displayName ?? '—')}</p>
            <p className="credential-label">Plateau Citizen ID</p>
            <p className="credential-pcid">{String(item.pcid ?? '—')}</p>
          </div>

          <dl className="facts" style={{ marginTop: '1.25rem' }}>
            <dt>Credential serial</dt>
            <dd className="mono">{credential?.serial ?? '—'}</dd>
            <dt>Issued</dt>
            <dd>{formatDate(credential?.issuedAt)}</dd>
            <dt>Valid until</dt>
            <dd>{formatDate(credential?.expiresAt)}</dd>
            {item.verificationLevel === undefined ? null : (
              <>
                <dt>Identity checked</dt>
                <dd>{verificationLabel(String(item.verificationLevel))}</dd>
              </>
            )}
          </dl>

          {/*
            Keeping the identifier on the phone, for a queue with no coverage
            (§56). Offered here, beside the card it copies, rather than buried in
            settings - it is a property of this card, not of the account.
          */}
          <KeepCardOffline />
        </section>

        <section className="card" aria-labelledby="qr-heading">
          <div className="card-header">
            <h2 id="qr-heading">Show this to an officer</h2>
          </div>

          {qrSvg === null ? (
            <Notice tone="danger" title="No valid credential">
              You reported this credential lost. Refresh the page to be issued a new one, or visit a
              registration desk.
            </Notice>
          ) : (
            <div className="qr-panel">
              <div
                className="qr-frame"
                role="img"
                aria-label="Square code for a government officer to scan"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div>
                <p>
                  An officer scans this to confirm the ID is yours and still valid. It shows them
                  your name and nothing else.
                </p>
                <p className="small muted">
                  This code stops working in about{' '}
                  {relativeMinutes(credential!.verificationTokenExpiresAt)} minutes. Reload the page
                  for a new one. That is deliberate: a photograph of your screen is of no use to
                  anyone afterwards.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="verify-history">
        <div className="card-header">
          <h2 id="verify-history">When your ID has been checked</h2>
        </div>
        {history === null || history.verifications.length === 0 ? (
          <p className="muted">Nobody has checked your ID yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">
                Occasions on which a government office checked your Plateau Citizen ID
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Office</th>
                  <th scope="col">How</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.verifications.map((entry, index) => (
                  <tr key={`${entry.occurredAt}-${index}`}>
                    <td>{formatDateTime(entry.occurredAt)}</td>
                    <td>{entry.agency ?? '—'}</td>
                    <td>
                      {entry.method === 'CREDENTIAL_QR' ? 'Scanned the code' : 'Typed the ID'}
                    </td>
                    <td>
                      <Badge tone={entry.outcome === 'PERMITTED' ? 'ok' : 'danger'}>
                        {entry.outcome === 'PERMITTED' ? 'Checked' : 'Refused'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="lost-heading">
        <div className="card-header">
          <h3 id="lost-heading">Lost or stolen card</h3>
        </div>
        <p>
          Report it and the credential stops working immediately, everywhere. Your Plateau Citizen
          ID itself is unaffected — a card can be replaced, an identity cannot.
        </p>
        <form action={reportCredentialLost} noValidate>
          <TextArea
            name="reason"
            label="What happened"
            hint="A sentence is enough. For example: my card was taken from my bag at the market."
            required
            maxLength={500}
          />
          <SubmitButton className="button button-danger" pendingLabel="Reporting…">
            Report this credential lost
          </SubmitButton>
        </form>
      </section>
    </>
  );
}

function verificationLabel(level: string): string {
  switch (level) {
    case 'SELF_ASSERTED':
      return 'Details you gave us';
    case 'DOCUMENT_VERIFIED':
      return 'Checked against a document';
    case 'AGENCY_VERIFIED':
      return 'Confirmed by a government office';
    case 'BIOMETRIC_VERIFIED':
      return 'Confirmed in person';
    default:
      return sentenceCase(level);
  }
}
