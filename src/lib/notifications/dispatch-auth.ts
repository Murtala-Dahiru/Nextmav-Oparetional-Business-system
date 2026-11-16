import { createHash, timingSafeEqual } from 'node:crypto';

/** Machine authentication for the single notification dispatcher, never a user session. */
export function authenticate(req: Request): Response | null {
  const secret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: 'Dispatch unavailable' }, { status: 503 });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const supplied = req.headers.get('authorization') ?? '';
  if (!timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}
