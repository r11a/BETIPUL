import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PREFIX = 'btp1';

export async function loadClinicalKey(dataDir) {
  const keyPath = path.join(dataDir, 'keys', 'clinical.key');
  await mkdir(path.dirname(keyPath), { recursive: true });
  try {
    return Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64url');
  } catch {
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString('base64url'), { mode: 0o600 });
    return key;
  }
}

export function createFieldCrypto(key) {
  const encrypt = (value, context = 'clinical') => {
    if (value === undefined || value === null || value === '') return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  };
  const decrypt = (value, context = 'clinical') => {
    if (!value) return '';
    try {
      const [prefix, iv, tag, ciphertext] = String(value).split('.');
      if (prefix !== PREFIX) throw new Error('unsupported encrypted value');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return '[מידע מוצפן שאינו זמין]';
    }
  };
  const lookupHash = (value) => createHmac('sha256', key).update(String(value || '').trim().toLowerCase()).digest('hex');
  return { encrypt, decrypt, lookupHash };
}

export function deriveBackupKey(passphrase, salt) {
  return scryptSync(String(passphrase), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function safeErrorFingerprint(error) {
  return createHash('sha256').update(String(error?.message || error)).digest('hex').slice(0, 12);
}
