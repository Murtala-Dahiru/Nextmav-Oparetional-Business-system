'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Mail,
  Phone,
  MapPin,
  Send,
  Loader2,
  Clock,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

const contactInfo = [
  {
    icon: Mail,
    label: 'Email',
    value: 'hello@nexuscorp.io',
    href: 'mailto:hello@nexuscorp.io',
  },
  {
    icon: Phone,
    label: 'Phone',
    value: '+1 (555) 123-4567',
    href: 'tel:+15551234567',
  },
  {
    icon: MapPin,
    label: 'Office',
    value: '123 Enterprise Blvd, San Francisco, CA 94105',
    href: null,
  },
  {
    icon: Clock,
    label: 'Business Hours',
    value: 'Mon–Fri, 9:00 AM – 6:00 PM PST',
    href: null,
  },
];

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        toast.error('Failed to send message. Please try again.');
        return;
      }

      toast.success('Message sent successfully! We\'ll get back to you soon.');
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Get in <span className="text-emerald-500">touch</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Have a question or want to learn more? We&apos;d love to hear from you.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
          {/* Contact Form */}
          <div className="lg:col-span-3">
            <Card className="border-gray-200 dark:border-gray-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <MessageSquare className="size-5 text-emerald-500" />
                  Send us a message
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contact-name">Your name</Label>
                      <Input
                        id="contact-name"
                        placeholder="John Doe"
                        value={formData.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        required
                        disabled={isLoading}
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contact-email">Email address</Label>
                      <Input
                        id="contact-email"
                        type="email"
                        placeholder="you@company.com"
                        value={formData.email}
                        onChange={(e) => updateField('email', e.target.value)}
                        required
                        disabled={isLoading}
                        className="h-11"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-subject">Subject</Label>
                    <Input
                      id="contact-subject"
                      placeholder="How can we help?"
                      value={formData.subject}
                      onChange={(e) => updateField('subject', e.target.value)}
                      required
                      disabled={isLoading}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-message">Message</Label>
                    <Textarea
                      id="contact-message"
                      placeholder="Tell us more about your inquiry..."
                      rows={5}
                      value={formData.message}
                      onChange={(e) => updateField('message', e.target.value)}
                      required
                      disabled={isLoading}
                      className="min-h-[120px]"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="bg-emerald-500 hover:bg-emerald-600 text-white h-11 px-6"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="size-4" />
                        Send message
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Contact Info Sidebar */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-gray-200 dark:border-gray-800">
              <CardHeader>
                <CardTitle className="text-xl">Contact information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {contactInfo.map((info) => {
                  const Icon = info.icon;
                  const content = (
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center shrink-0">
                        <Icon className="size-5 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{info.label}</p>
                        <p className="text-sm text-muted-foreground">{info.value}</p>
                      </div>
                    </div>
                  );
                  return info.href ? (
                    <a
                      key={info.label}
                      href={info.href}
                      className="block hover:opacity-80 transition-opacity"
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={info.label}>{content}</div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Map Placeholder */}
            <Card className="border-gray-200 dark:border-gray-800 overflow-hidden">
              <CardContent className="p-0">
                <div className="bg-gray-100 dark:bg-gray-900 h-64 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <MapPin className="size-8 text-emerald-500 mx-auto" />
                    <p className="text-sm text-muted-foreground font-medium">
                      San Francisco, CA
                    </p>
                    <p className="text-xs text-muted-foreground">
                      123 Enterprise Blvd, Suite 400
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
    </div>
  );
}