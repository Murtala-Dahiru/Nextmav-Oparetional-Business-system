'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Mail, CheckCircle2, BookOpen, Activity, LifeBuoy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Container, Eyebrow } from '@/components/marketing/section';
import { Field } from '@/components/forms/field';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Contact
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The form did not work, and still has no server ───────────────────────
 *
 *  It posted to `/api/support/tickets`, which requires a session and an
 *  organization membership. Everyone who uses this page has neither, so every
 *  submission was refused by middleware and the visitor was shown "Failed to
 *  send message. Please try again." The most motivated ones tried again.
 *
 *  Phase 1 is explicitly fenced out of the backend, so the honest options were
 *  (a) ship a form that silently fails, (b) ship no form, or (c) ship a form
 *  with a transport that needs no server. (a) is what we are removing. (b)
 *  loses the structure that makes an enquiry useful to answer — what they run,
 *  how many people, which problem.
 *
 *  So: (c). The form composes a `mailto:` and the button says exactly that.
 *  Nothing is queued, nothing is claimed to have been sent, and nothing
 *  depends on an endpoint that does not exist. When the Phase 2 endpoint
 *  lands, only `handleSubmit` changes — the fields, validation, states and
 *  copy are already the ones a real submission wants.
 *
 *  ── Three things removed from the sidebar ────────────────────────────────
 *
 *  A phone number: `+1 (555) 123-4567`. The 555 exchange is the one American
 *  film productions use precisely because it cannot be dialled.
 *
 *  An office: "123 Enterprise Blvd, San Francisco, CA 94105" — a placeholder
 *  street on a real financial-district postcode.
 *
 *  A map: a grey rectangle with a pin icon and that same invented address
 *  underneath, spending 256px of page depicting a building that does not exist.
 *
 *  Anybody who checks any of the three learns the site is decorated with
 *  invented facts — on the page they opened specifically to find out whether
 *  there is a real company here.
 */

/**
 * PLACEHOLDER — see CONTENT-NEEDED.md.
 *
 * One constant, not five literals, so replacing it is a single edit rather
 * than a search. Every intent below falls back to it.
 */
const CONTACT_EMAIL = 'hello@example.com';

/**
 * Routing by intent.
 *
 * The old form had a free-text "Subject" and nothing else, so a sales enquiry,
 * a security disclosure and a password problem all arrived in the same shape
 * and were triaged by reading them. Asking one question up front is the
 * cheapest possible routing, and it changes the placeholder text so the person
 * writing knows what detail is actually useful.
 */
const INTENTS = [
  {
    id: 'sales',
    label: 'Evaluating NextMav',
    to: CONTACT_EMAIL,
    hint: 'What you run today, roughly how many people, and what is not working.',
    subject: 'Evaluating NextMav for ',
  },
  {
    id: 'support',
    label: 'I’m already a customer',
    to: CONTACT_EMAIL,
    hint: 'Your workspace name and what you were doing when it went wrong.',
    subject: 'Support — ',
  },
  {
    id: 'security',
    label: 'Security disclosure',
    to: CONTACT_EMAIL,
    hint: 'Steps to reproduce, and how you would like to be credited.',
    subject: 'Security disclosure — ',
  },
  {
    id: 'partnership',
    label: 'Partnership or press',
    to: CONTACT_EMAIL,
    hint: 'Who you are and what you have in mind.',
    subject: 'Partnership — ',
  },
] as const;

type IntentId = (typeof INTENTS)[number]['id'];

const elsewhere = [
  {
    icon: BookOpen,
    title: 'Documentation',
    body: 'How the modules fit together, and the API.',
    href: '/docs',
  },
  {
    icon: LifeBuoy,
    title: 'Help centre',
    body: 'Answers to the questions we are asked most.',
    href: '/help',
  },
  {
    icon: Activity,
    title: 'System status',
    body: 'Live availability, and the record of past incidents.',
    href: '/status',
  },
];

export default function ContactPage() {
  const [intent, setIntent] = useState<IntentId>('sales');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  /**
   * Which fields the person has finished with.
   *
   * Validation runs on blur, never on keystroke — the skill's
   * `inline-validation` rule, and simple decency: marking an email invalid
   * while somebody is on the third character of it is the interface telling
   * them off for not having finished typing yet.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState(false);

  const active = INTENTS.find((i) => i.id === intent)!;

  const errors = {
    name: formData.name.trim() ? null : 'Please tell us your name.',
    email: !formData.email.trim()
      ? 'We need an address to reply to.'
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())
        ? null
        : 'That address is missing an @ or a domain.',
    subject: formData.subject.trim() ? null : 'A short subject helps us route this.',
    message: formData.message.trim().length >= 10
      ? null
      : 'A sentence or two about what you need.',
  };
  const valid = Object.values(errors).every((e) => e === null);

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Reveal every outstanding error at once rather than one per attempt, and
    // move focus to the first of them — `focus-management` in the skill's
    // forms rules, and the difference between "fix this" and "guess again".
    if (!valid) {
      setTouched({ name: true, email: true, subject: true, message: true });
      const firstBad = ['name', 'email', 'subject', 'message'].find(
        (f) => errors[f as keyof typeof errors],
      );
      if (firstBad) document.getElementById(`contact-${firstBad}`)?.focus();
      return;
    }

    const body = [
      formData.message.trim(),
      '',
      '—',
      formData.name.trim(),
      formData.email.trim(),
      `Enquiry type: ${active.label}`,
    ].join('\r\n');

    window.location.href =
      `mailto:${active.to}` +
      `?subject=${encodeURIComponent(formData.subject.trim())}` +
      `&body=${encodeURIComponent(body)}`;

    setSent(true);
  }

  return (
    <Container className="py-16 sm:py-24">
      <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <h1 className="text-display-2 text-balance-hero mt-5">
            Tell us what you’re trying to run.
          </h1>
          <p className="text-muted-foreground text-lede text-pretty-body mt-5 max-w-xl">
            Questions about fit, migration, pricing for a larger team, or
            anything the documentation doesn’t answer. A person reads these.
          </p>

          {sent ? (
            /*
             * The submitted state, designed as carefully as the form.
             *
             * It says what actually happened — a draft was opened — because
             * claiming "message sent" when the person may have closed their
             * mail client without pressing send is the kind of small lie that
             * produces a follow-up email two weeks later asking why nobody
             * replied.
             */
            <div
              className="border-brand-line bg-brand-soft mt-10 rounded-xl border p-6"
              role="status"
            >
              <CheckCircle2 className="text-brand size-6" strokeWidth={1.9} aria-hidden="true" />
              <h2 className="mt-4 text-[1.125rem] font-semibold tracking-[-0.02em]">
                Your email app should be open
              </h2>
              <p className="text-foreground/75 mt-2 text-[0.9375rem] leading-relaxed">
                We’ve filled in a draft to{' '}
                <span className="font-medium">{active.to}</span> with everything
                you wrote. Press send there and it reaches us — we reply within
                one working day.
              </p>
              <p className="text-muted-foreground mt-3 text-[0.875rem] leading-relaxed">
                Nothing opened? Copy the address above and send it manually;
                some browsers block mail links.
              </p>
              <Button
                variant="ctaOutline"
                size="xl"
                className="mt-6"
                onClick={() => {
                  setSent(false);
                  setTouched({});
                }}
              >
                Back to the form
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="mt-10 space-y-6">
              <fieldset>
                <legend className="text-[0.875rem] font-medium">
                  What’s this about?
                </legend>
                <p className="text-muted-foreground mt-1 text-[0.8125rem]">
                  So it reaches the right person first time.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {INTENTS.map((i) => (
                    <label
                      key={i.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-3 text-[0.875rem] transition-colors',
                        // ≥44px tall, per the skill's touch-target rule — a
                        // radio you have to aim at is a radio people mis-tap.
                        intent === i.id
                          ? 'border-ink bg-surface font-medium'
                          : 'border-hairline hover:border-hairline-strong',
                      )}
                    >
                      <input
                        type="radio"
                        name="intent"
                        value={i.id}
                        checked={intent === i.id}
                        onChange={() => setIntent(i.id)}
                        className="accent-brand size-4"
                      />
                      {i.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="contact-name"
                  label="Your name"
                  error={touched.name ? errors.name : null}
                >
                  <Input
                    id="contact-name"
                    placeholder="Alex Morgan"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    maxLength={120}
                    autoComplete="name"
                    aria-invalid={!!(touched.name && errors.name)}
                    className="h-11"
                  />
                </Field>

                <Field
                  id="contact-email"
                  label="Work email"
                  error={touched.email ? errors.email : null}
                >
                  <Input
                    id="contact-email"
                    type="email"
                    inputMode="email"
                    placeholder="you@company.com"
                    value={formData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    maxLength={254}
                    autoComplete="email"
                    aria-invalid={!!(touched.email && errors.email)}
                    className="h-11"
                  />
                </Field>
              </div>

              <Field
                id="contact-subject"
                label="Subject"
                error={touched.subject ? errors.subject : null}
              >
                <Input
                  id="contact-subject"
                  placeholder={`${active.subject}60 people across three tools`}
                  value={formData.subject}
                  onChange={(e) => updateField('subject', e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, subject: true }))}
                  maxLength={200}
                  aria-invalid={!!(touched.subject && errors.subject)}
                  className="h-11"
                />
              </Field>

              <Field
                id="contact-message"
                label="Message"
                hint={active.hint}
                error={touched.message ? errors.message : null}
              >
                <Textarea
                  id="contact-message"
                  rows={6}
                  value={formData.message}
                  onChange={(e) => updateField('message', e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, message: true }))}
                  maxLength={5000}
                  aria-invalid={!!(touched.message && errors.message)}
                  className="min-h-[9rem] resize-y"
                />
              </Field>

              {/*
                The button says what pressing it does. "Send message" would be
                a small lie — it opens a draft, and a person who expects a
                confirmation screen and gets Outlook is a person who thinks
                the site is broken.
              */}
              <Button type="submit" variant="cta" size="xl" className="w-full sm:w-auto">
                <Mail className="size-4" />
                Open this in your email app
              </Button>
            </form>
          )}
        </div>

        <aside className="lg:pt-[7.5rem]">
          <div className="border-hairline bg-surface rounded-xl border p-6">
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
              What to expect
            </h2>
            <dl className="mt-4 space-y-3 text-[0.875rem]">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">First reply</dt>
                <dd className="font-medium">One working day</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Who answers</dt>
                <dd className="font-medium">A person, not a bot</dd>
              </div>
            </dl>
            <p className="text-muted-foreground border-hairline mt-4 border-t pt-4 text-[0.8125rem] leading-relaxed">
              Already using NextMav? Raising a ticket inside the product reaches
              the same people with your workspace attached, which is usually the
              difference between one reply and three.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand mt-4 inline-flex items-center gap-1.5 text-[0.875rem] font-medium hover:underline"
            >
              {CONTACT_EMAIL}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="mt-6 space-y-3">
            {elsewhere.map(({ icon: Icon, title, body, href }) => (
              <Link
                key={title}
                href={href}
                className="border-hairline hover:border-hairline-strong hover:bg-surface block rounded-xl border p-5 transition-colors"
              >
                <div className="flex items-start gap-3.5">
                  <Icon
                    className="text-brand mt-0.5 size-[1.0625rem] shrink-0"
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                      {title}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-[0.875rem] leading-relaxed">
                      {body}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </Container>
  );
}
