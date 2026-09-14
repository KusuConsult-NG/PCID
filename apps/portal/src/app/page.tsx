import { redirect } from 'next/navigation';

import { readSession } from '@/lib/session';

export default async function Home() {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId !== null) redirect('/sign-in/verify');
  if (session.mustChangePassword) redirect('/change-passphrase');
  redirect('/dashboard');
}
