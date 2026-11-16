'use client';

import { useState } from 'react';
import { Mail, LifeBuoy, Check, ArrowRight } from 'lucide-react';
import { Container, Section, Eyebrow, Input, Textarea, buttonClass } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
// Only publish a mailbox that the deployment owner has explicitly configured.
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || '';
const CONTACT_CONFIGURED = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(CONTACT_EMAIL) && !CONTACT_EMAIL.endsWith('@example.com');

/**
 * The uploaded project's Contact page, ported — dark hero, a channel column
 * beside the form, the same field set and success state.
 *
 * ── The submit had to be real ────────────────────────────────────────────
 *
 * The uploaded implementation calls `setTimeout(800)` and then shows "Message
 * received. We'll get back to you within one business day." It posts nowhere.
 * Shipping that means taking somebody's enquiry, telling them it arrived, and
 * discarding it — the single worst thing a contact page can do, and worse than
 * having no form at all.
 *
 * There is no `/api/contact` here yet; the spec for one is CONTENT-NEEDED #11.
 * So the form composes a mail message and the button says exactly that. The
 * success state is kept, and now describes something that happened.
 *
 * ── The channel column ───────────────────────────────────────────────────
 *
 * The upload prints `sales@nextmav.com` and `support@nextmav.com`. Neither has
 * been confirmed to exist, and publishing an address that bounces is worse than
 * publishing an obvious placeholder — only the second kind gets noticed and
 * fixed. Both route through `CONTACT_EMAIL` until real ones are supplied.
 *
 * "Response time — within one business day" is removed for the same reason: it
 * is a commitment nobody has made. Logged as CONTENT-NEEDED.
 */

const CHANNELS = [
  {
    icon: Mail,
    label: 'Sales',
    val: CONTACT_CONFIGURED ? CONTACT_EMAIL : 'Sales enquiries',
    desc: 'Review product capabilities and provisional pricing before you choose a workspace.',
  },
  {
    icon: LifeBuoy,
    label: 'Support',
    val: CONTACT_CONFIGURED ? CONTACT_EMAIL : 'Use your workspace support module',
    desc: 'For existing customers needing technical assistance.',
  },
  { icon: Mail, label: 'Partnerships & general enquiries', val: 'Tell us what you have in mind', desc: 'Use the form for a product demonstration, partnership or general question when the contact channel is available.' },
];

type Errors = Partial<Record<'name' | 'email' | 'org' | 'message', string>>;

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: '',
    email: '',
    org: '',
    size: '',
    message: '',
  });

  const errors: Errors = {
    name: form.name.trim() ? undefined : 'Please tell us your name.',
    email: !form.email.trim()
      ? 'We need an address to reply to.'
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
        ? undefined
        : 'That address does not look right.',
    org: form.org.trim() ? undefined : 'Which organization is this for?',
    message:
      form.message.trim().length >= 10
        ? undefined
        : 'A sentence or two helps us reply usefully.',
  };

  const valid = !errors.name && !errors.email && !errors.org && !errors.message;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validation surfaces on submit as well as on blur, so a keyboard user who
    // tabs straight to the button is not met with silence.
    setTouched({ name: true, email: true, org: true, message: true });
    if (!valid || !CONTACT_CONFIGURED) return;

    const body = [
      form.message.trim(),
      '',
      `— ${form.name.trim()}`,
      form.org.trim(),
      form.size.trim() ? `Team size: ${form.size.trim()}` : '',
      form.email.trim(),
    ]
      .filter(Boolean)
      .join('\n');

    window.location.href =
      `mailto:${CONTACT_EMAIL}` +
      `?subject=${encodeURIComponent(`Enquiry — ${form.org.trim()}`)}` +
      `&body=${encodeURIComponent(body)}`;

    setSent(true);
  };

  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark nm-contact-hero">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Contact</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            Let’s talk about{' '}
            <span className="nm-serif">your business.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            Whether you&rsquo;re evaluating platforms or ready to get started,
            we&rsquo;ll help you understand how NextMav fits your organization —
            including where it doesn&rsquo;t.
          </p>
        </Container>
      </section>

      <Section aria-labelledby="contact">
        <Container>
          <h2 id="contact" className="nm-sr-only">
            Contact us
          </h2>
          <div className="nm-contact-grid">
            <ScrollReveal className="nm-contact-info">
              <div className="nm-contact-channels"><Eyebrow>A useful first conversation</Eyebrow><h2 className="nm-heading-lg">Start with what<br />your team needs.</h2><p className="nm-lead">Your current tools, the handoffs that slow you down, and the capabilities you need. These are the right starting points for evaluating NextMav.</p>
                {CHANNELS.map((channel) => (
                  <div key={channel.label} className="nm-contact-channel">
                    <div className="nm-contact-channel-icon">
                      <channel.icon size={18} aria-hidden="true" />
                    </div>
                    <div className="nm-contact-channel-content">
                      <span className="nm-contact-channel-label">{channel.label}</span>
                      <span className="nm-contact-channel-val">{channel.val}</span>
                      <span className="nm-contact-channel-desc">{channel.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollReveal>

            <ScrollReveal delay={1}>
              {sent ? (
                <div className="nm-contact-form nm-contact-success">
                  <div className="nm-contact-success-icon">
                    <Check size={28} aria-hidden="true" />
                  </div>
                  <h3 className="nm-heading-sm">Continue in your email app.</h3>
                  <p className="nm-lead" style={{ fontSize: 'var(--nm-text-sm)' }}>
                    Your message has not been sent by this website. Review and send the draft in your email app. If
                    nothing opened, write to {CONTACT_EMAIL} directly.
                  </p>
                </div>
              ) : (
                <form className="nm-contact-form" onSubmit={onSubmit} noValidate>
                  <div className="nm-contact-form-head">
                    <h3 className="nm-contact-form-title">Start a conversation</h3>
                    <p className="nm-contact-form-sub">
                      {CONTACT_CONFIGURED ? 'Prepare a draft in your email app. You review and send it there.' : 'The public contact channel is not connected yet. This form cannot send a message.'}
                    </p>
                  </div>
                  <div className="nm-contact-form-row">
                    <Input
                      label="Your name"
                      name="name"
                      required
                      placeholder=""
                      autoComplete="name"
                      value={form.name}
                      onChange={set('name')}
                      onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                      error={touched.name ? errors.name : undefined}
                    />
                    <Input
                      label="Work email"
                      type="email"
                      name="email"
                      required
                      placeholder=""
                      autoComplete="email"
                      value={form.email}
                      onChange={set('email')}
                      onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                      error={touched.email ? errors.email : undefined}
                    />
                  </div>
                  <Input
                    label="Organization"
                    name="org"
                    required
                    placeholder=""
                    autoComplete="organization"
                    value={form.org}
                    onChange={set('org')}
                    onBlur={() => setTouched((t) => ({ ...t, org: true }))}
                    error={touched.org ? errors.org : undefined}
                  />
                  <Input
                    label="How many people?"
                    name="size"
                    placeholder="Approximate headcount"
                    value={form.size}
                    onChange={set('size')}
                  />
                  <Textarea
                    label="What are you looking for?"
                    name="message"
                    placeholder="Tell us about your organization and what you're evaluating."
                    rows={4}
                    value={form.message}
                    onChange={set('message')}
                    onBlur={() => setTouched((t) => ({ ...t, message: true }))}
                    error={touched.message ? errors.message : undefined}
                  />
                  {!CONTACT_CONFIGURED && <div className="nm-contact-unconfigured" role="status"><strong>Contact is not configured</strong><p>A verified contact mailbox is required before this form can open an email draft. No message will be sent or stored here.</p></div>}
                  <button type="submit" disabled={!CONTACT_CONFIGURED} className={buttonClass('primary', 'lg', 'nm-contact-submit')}>
                    {CONTACT_CONFIGURED ? 'Open email draft' : 'Contact channel unavailable'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </form>
              )}
            </ScrollReveal>
          </div>
        </Container>
      </Section>
    </>
  );
}
