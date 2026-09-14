'use client';

/**
 * What a device holds when it has no signal, and how it holds it (§56).
 *
 * The portals are server-rendered precisely so that no API token reaches the
 * browser, and nothing here changes that: what is stored is *data the platform
 * already released to this person*, never authority to ask for more. The device
 * token kept alongside it authenticates nothing on its own - it names a
 * registered device and is refused without a signed-in session.
 *
 * The encryption is worth being exact about, because it is easy to overstate.
 * The key is generated in the browser as non-extractable, so `crypto.subtle`
 * will use it and will not hand it back: an image of the device's storage, a
 * backup pulled off a phone, another application reading the profile directory,
 * all get ciphertext. It does **not** protect against somebody using the phone
 * while it is unlocked - nothing in a browser can - which is why the other five
 * §56 properties are not optional: short expiry, minimal content, revocation,
 * device binding, and a release the platform can account for afterwards.
 */

const DATABASE = 'pcid-offline';
const DATABASE_VERSION = 1;
const KEY_STORE = 'device';
const BUNDLE_STORE = 'bundles';
const DEVICE_KEY_ID = 'device-key';
const DEVICE_TOKEN_ID = 'device-token';

export interface HeldBundle<T = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly releaseId: string;
  readonly expiresAt: string;
  readonly storedAt: string;
  readonly payload: T;
}

interface StoredBundle {
  id: string;
  kind: string;
  releaseId: string;
  expiresAt: string;
  storedAt: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(BUNDLE_STORE)) {
        db.createObjectStore(BUNDLE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('offline storage unavailable'));
  });
}

function run<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('offline storage failed'));
    store.transaction.onabort = () =>
      reject(store.transaction.error ?? new Error('offline storage aborted'));
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await open();
  try {
    return await work(db.transaction(name, mode).objectStore(name));
  } finally {
    db.close();
  }
}

/**
 * The device's key, created once and never leaving the browser.
 *
 * `extractable: false` is the whole point: WebCrypto will encrypt and decrypt
 * with it and has no operation that returns it, so the key cannot be copied out
 * by script, by an extension, or by anything reading the stored object.
 */
export async function deviceKey(): Promise<CryptoKey> {
  const existing = await withStore(KEY_STORE, 'readonly', (store) =>
    run(store, store.get(DEVICE_KEY_ID) as IDBRequest<CryptoKey | undefined>),
  );
  if (existing !== undefined) return existing;

  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await withStore(KEY_STORE, 'readwrite', (store) =>
    run(store, store.put(created, DEVICE_KEY_ID) as IDBRequest<IDBValidKey>),
  );
  return created;
}

export async function readDeviceToken(): Promise<string | null> {
  const token = await withStore(KEY_STORE, 'readonly', (store) =>
    run(store, store.get(DEVICE_TOKEN_ID) as IDBRequest<string | undefined>),
  );
  return token ?? null;
}

export async function writeDeviceToken(token: string): Promise<void> {
  await withStore(KEY_STORE, 'readwrite', (store) =>
    run(store, store.put(token, DEVICE_TOKEN_ID) as IDBRequest<IDBValidKey>),
  );
}

/** Seal a bundle under the device key and keep it against an id of the caller's choosing. */
export async function keep(input: {
  id: string;
  kind: string;
  releaseId: string;
  expiresAt: string;
  payload: unknown;
}): Promise<void> {
  const key = await deviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(input.payload)),
  );
  const record: StoredBundle = {
    id: input.id,
    kind: input.kind,
    releaseId: input.releaseId,
    expiresAt: input.expiresAt,
    storedAt: new Date().toISOString(),
    iv: iv.buffer as ArrayBuffer,
    ciphertext,
  };
  await withStore(BUNDLE_STORE, 'readwrite', (store) =>
    run(store, store.put(record) as IDBRequest<IDBValidKey>),
  );
}

/**
 * Read a bundle back, refusing an expired one and erasing it on the way past.
 *
 * Expiry is checked here as well as at the platform, because the platform is the
 * thing that is not reachable when this matters. A client that trusted the
 * server to enforce a lifetime would hold an expired pack for as long as it
 * stayed offline, which is the one circumstance the lifetime is for.
 */
export async function held<T = unknown>(id: string): Promise<HeldBundle<T> | null> {
  const record = await withStore(BUNDLE_STORE, 'readonly', (store) =>
    run(store, store.get(id) as IDBRequest<StoredBundle | undefined>),
  );
  if (record === undefined) return null;
  if (Date.parse(record.expiresAt) <= Date.now()) {
    await erase(id);
    return null;
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
      await deviceKey(),
      record.ciphertext,
    );
    return {
      id: record.id,
      kind: record.kind,
      releaseId: record.releaseId,
      expiresAt: record.expiresAt,
      storedAt: record.storedAt,
      payload: JSON.parse(new TextDecoder().decode(plaintext)) as T,
    };
  } catch {
    // A bundle that will not decrypt is a bundle whose key is gone: the browser
    // data was cleared, or the store was tampered with. Either way it is not
    // readable and keeping it is pointless.
    await erase(id);
    return null;
  }
}

export async function listHeld(): Promise<
  readonly { id: string; kind: string; releaseId: string; expiresAt: string }[]
> {
  const records = await withStore(BUNDLE_STORE, 'readonly', (store) =>
    run(store, store.getAll() as IDBRequest<StoredBundle[]>),
  );
  return records.map((record) => ({
    id: record.id,
    kind: record.kind,
    releaseId: record.releaseId,
    expiresAt: record.expiresAt,
  }));
}

export async function erase(id: string): Promise<void> {
  await withStore(BUNDLE_STORE, 'readwrite', (store) =>
    run(store, store.delete(id) as IDBRequest<undefined>),
  );
}

/**
 * Erase everything, including the device identity.
 *
 * Called when the platform says this device may no longer hold anything, and
 * when somebody signs out. It removes the key as well as the bundles, so what is
 * left behind cannot be read even if the ciphertext were recovered.
 */
export async function eraseEverything(): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction([KEY_STORE, BUNDLE_STORE], 'readwrite');
    transaction.objectStore(KEY_STORE).clear();
    transaction.objectStore(BUNDLE_STORE).clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('erase failed'));
    });
  } finally {
    db.close();
  }
}

/** True where the browser can do any of this at all. */
export function offlineStorageAvailable(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined'
  );
}
