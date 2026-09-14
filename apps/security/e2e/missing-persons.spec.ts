/**
 * The missing-person desk, and the line the portal will not let anybody cross.
 *
 * The matching engine produces candidates and the factors that produced them.
 * It identifies nobody: confirming a candidate is a separate act by a named
 * supervisor, and the database refuses a confirmed match with no reviewer. These
 * tests assert that the interface says so and offers the officer who ran the
 * search no way to decide it.
 */
import { expect, test } from '@playwright/test';

const SEEDED_ENQUIRY = 'Rahila Choji';

test('the register lists the open enquiries', async ({ page }) => {
  await page.goto('/missing-persons');

  await expect(page.getByRole('heading', { name: 'Missing persons', level: 1 })).toBeVisible();
  const register = page.getByRole('table', { name: 'Missing-person enquiries' });
  await expect(register.getByText(SEEDED_ENQUIRY)).toBeVisible();
});

test('an enquiry carries what the family said and can be revised', async ({ page }) => {
  await page.goto('/missing-persons');
  await page
    .getByRole('table', { name: 'Missing-person enquiries' })
    .getByRole('link')
    .first()
    .click();

  await expect(page.getByRole('heading', { name: SEEDED_ENQUIRY, level: 1 })).toBeVisible();
  // Scoped to the header: the revise form holds the same words in a textarea,
  // which is the point of the form rather than an accident.
  const header = page.locator('.page-header');
  await expect(header).toContainText('Did not return from school on Tuesday afternoon.');

  await page
    .getByLabel('What they look like')
    .fill('About 1.6m, plaited hair, green school uniform, small scar over the left eyebrow.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Enquiry updated')).toBeVisible();
  await expect(page.getByLabel('What they look like')).toHaveValue(
    /small scar over the left eyebrow/,
  );
});

test('a sighting is unverified until an officer checks it, and discounting is an outcome', async ({
  page,
}) => {
  await page.goto('/missing-persons');
  await page
    .getByRole('table', { name: 'Missing-person enquiries' })
    .getByRole('link')
    .first()
    .click();

  const sightings = page.getByRole('region', { name: 'Sightings' });
  await sightings
    .getByLabel('What was seen')
    .fill('A shopkeeper reports a girl of about that age buying bread on Tuesday evening.');
  await sightings.getByLabel('Where').fill('Rukuba Road market');
  await sightings.getByLabel('Who reported it').fill('Shopkeeper');
  await sightings.getByRole('button', { name: 'Record this sighting' }).click();

  await expect(page.getByText('Sighting recorded')).toBeVisible();

  const recorded = page.getByRole('region', { name: 'Sightings' });
  await expect(recorded.getByText('Rukuba Road market')).toBeVisible();
  await expect(recorded.getByText('Unverified').first()).toBeVisible();

  // Discounting is offered as plainly as confirming. A file whose only exit is
  // confirmation only ever grows.
  await expect(recorded.getByRole('button', { name: 'Discounted' }).first()).toBeVisible();
  await recorded.getByRole('button', { name: 'Checked out' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sighting reviewed' })).toBeVisible();
});

test('the engine produces candidates, never an identification', async ({ page }) => {
  await page.goto('/missing-persons');
  await page
    .getByRole('table', { name: 'Missing-person enquiries' })
    .getByRole('link')
    .first()
    .click();

  const candidates = page.getByRole('region', { name: 'Candidate matches' });
  await expect(candidates.getByText('A candidate is not an identification')).toBeVisible();

  await candidates.getByRole('button', { name: 'Run the matching engine' }).click();
  await expect(page.getByText('The matching engine has run')).toBeVisible();

  // Whatever it produced, the officer who ran it cannot decide it: MATCH_CONFIRM
  // belongs to a supervisor.
  const after = page.getByRole('region', { name: 'Candidate matches' });
  await expect(after.getByRole('button', { name: 'The same person' })).toHaveCount(0);
});

test('the unidentified-person register holds no field that says who somebody is', async ({
  page,
}) => {
  await page.goto('/unidentified-persons');
  await expect(page.getByRole('heading', { name: 'Unidentified persons', level: 1 })).toBeVisible();

  await page
    .getByRole('table', { name: 'Unidentified-person records' })
    .getByRole('link')
    .first()
    .click();

  await expect(page.getByRole('heading', { name: 'What is known', level: 2 })).toBeVisible();
  await expect(page.locator('.page-header')).toContainText('Elderly man, grey beard');

  // An identity comes from confirming a candidate match, not from an officer
  // typing an identifier into this record.
  await expect(page.getByText('There is no field here that says who somebody is')).toBeVisible();
  await expect(page.getByLabel('Plateau Citizen ID')).toHaveCount(0);
});

test('somebody found is recorded through the same register', async ({ page }) => {
  await page.goto('/unidentified-persons#record');

  const form = page.getByRole('region', { name: 'Record somebody found' });
  await form.getByLabel('Condition when found').selectOption('DECEASED');
  await form.getByLabel('Apparent age, from').fill('20');
  await form.getByLabel('Apparent age, to').fill('30');
  await form.getByLabel('Apparent sex').selectOption('FEMALE');
  await form
    .getByLabel('What they look like')
    .fill('Young woman, about 1.55m, no identification carried.');
  await form.getByLabel('Where they were found').fill('Lamingo dam path');
  await form.getByLabel('Local Government Area code').fill('PL-JNO');
  await form.getByRole('button', { name: 'Record this person' }).click();

  await expect(page.getByRole('heading', { name: 'Recorded', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is known', level: 2 })).toBeVisible();
});
