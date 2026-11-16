import { createECDH } from 'node:crypto';

/** Only return readiness and reason codes, never private configuration. */
export function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return { ready: false, reason: 'missing_vapid_configuration' };
  try {
    const contact = new URL(subject);
    if (!['mailto:', 'https:'].includes(contact.protocol) || !contact.pathname && !contact.hostname) throw Error();
    const pair = createECDH('prime256v1'); pair.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (pair.getPublicKey().toString('base64url') !== publicKey) return { ready: false, reason: 'vapid_key_mismatch' };
    return { ready: true, reason: null };
  } catch { return { ready: false, reason: 'invalid_vapid_configuration' }; }
}
