'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Logo, buttonClass } from './ui';
import { CONTACT_EMAIL } from '@/lib/public-contact';

/**
 * The uploaded project's footer, on this application's routes.
 *
 * ── Two things that could not be carried across as written ───────────────
 *
 * **The newsletter did not subscribe anyone.** The uploaded implementation
 * sets `subscribed` in local state, shows "Thanks — you'll hear from us
 * shortly", clears it after four seconds and posts to nothing. There is no
 * endpoint and no list. Shipping that means collecting an address, telling
 * somebody they are subscribed, and discarding it — which is a worse outcome
 * than not having the block at all.
 *
 * The block is kept, because it is part of the design. It composes a mail
 * message instead, and the button says so. That is the same pattern the
 * contact form already uses here, for the same reason, and it is honest about
 * where the address is going.
 *
 * **Four links pointed at the wrong page.** "Architecture" and "Security" both
 * went to `/features` generally, "Careers" to `/about`, and the upload has no
 * careers page. Architecture and Security now land on the section that answers
 * them; Careers is not advertised, because there is nothing behind it.
 */

const GROUPS = [
  {
    title: 'Platform',
    links: [
      { label: 'Features', href: '/features' },
      { label: 'Solutions', href: '/solutions' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Architecture', href: '/features#architecture' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
      { label: 'Blog', href: '/blog' },
      { label: 'Help', href: '/help' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Cookies', href: '/cookies' },
      { label: 'Security', href: '/features#platform' },
    ],
  },
];

export function PublicFooter() {
  const [email, setEmail] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    // No list to add to, so this hands the message to the reader's own mail
    // client rather than pretending a subscription happened.
    window.location.href =
      `mailto:${CONTACT_EMAIL}` +
      `?subject=${encodeURIComponent('Product updates')}` +
      `&body=${encodeURIComponent(`Please add ${address} to the product update list.`)}`;
  };

  return (
    <footer className="nm-footer">
      <div className="nm-footer-glow" />

      <div className="nm-container nm-footer-inner">
        <div className="nm-footer-brand">
          <Link href="/" aria-label="NextMav — home">
            <Logo size={32} />
          </Link>
          <p className="nm-footer-tag">
            The Business Operating System.
            <br />
            Run your organization from one connected platform.
          </p>

          <form className="nm-footer-newsletter" onSubmit={onSubmit}>
            <label className="nm-footer-newsletter-label" htmlFor="nm-newsletter">
              Product updates — monthly, no spam
            </label>
            <div className="nm-footer-newsletter-input">
              <input
                id="nm-newsletter"
                type="email"
                placeholder="Work email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="nm-footer-newsletter-field"
              />
              <button
                type="submit"
                className={buttonClass('primary', 'sm')}
                aria-label="Open this in your email app"
              >
                <ArrowRight size={16} />
              </button>
            </div>
            <p className="nm-footer-newsletter-confirm" style={{ opacity: 0.7 }}>
              Opens in your email app — we have no signup list yet.
            </p>
          </form>
        </div>

        <div className="nm-footer-nav">
          {GROUPS.map((group) => (
            <div key={group.title} className="nm-footer-col">
              <h2 className="nm-footer-title">{group.title}</h2>
              {group.links.map((link) => (
                <Link key={link.label} href={link.href} className="nm-footer-link">
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="nm-container nm-footer-base">
        <span className="nm-mono nm-footer-copyright">
          © {new Date().getFullYear()} NextMav. All rights reserved.
        </span>
        <div className="nm-footer-base-right">
          <Link href="/privacy" className="nm-footer-link">
            Privacy
          </Link>
          <Link href="/terms" className="nm-footer-link">
            Terms
          </Link>
          <Link href="/cookies" className="nm-footer-link">
            Cookies
          </Link>
        </div>
      </div>
    </footer>
  );
}
