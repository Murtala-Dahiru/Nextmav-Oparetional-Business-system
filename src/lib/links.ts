/**
 * External web addresses, normalised once.
 *
 * Written for the projects file panel in Phase 6 and lifted here at its second
 * consumer, the workspace file panel in Phase 13. The rule about which schemes
 * are allowed is a security rule, and a security rule that exists in two files
 * is one that will shortly exist in two versions.
 */

/**
 * A resource that lives somewhere else.
 *
 * Only http and https. `javascript:` in an href is a script that runs with the
 * page's origin the moment somebody clicks a row in a file list, and `data:`
 * is a way to serve arbitrary content from what looks like the company's own
 * document store. Both are refused here rather than sanitised at render time,
 * because a stored value that is only safe if every reader remembers to escape
 * it is one careless component away from being live.
 *
 * Returns null for anything that is not a usable address, which callers turn
 * into a 422 rather than storing.
 */
export function normaliseLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // A person types "figma.com/file/...", not a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.toString();
}

/** "figma.com" out of a long URL, for a row that has to stay one line. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}
