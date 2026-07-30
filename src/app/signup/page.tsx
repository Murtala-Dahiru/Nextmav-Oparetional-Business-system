'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Hexagon, Loader2, Eye, EyeOff, MailCheck } from 'lucide-react';
import { PLATFORM } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function SignupPage() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    organization: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password,
          organizationName: formData.organization,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error?.message || 'Signup failed. Please try again.');
        return;
      }

      // With email confirmation enabled the response carries no session, so
      // navigating to /dashboard would bounce straight back to /login with
      // nothing explaining why. Show what actually has to happen next.
      if (data.data?.requiresEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }

      toast.success('Account created successfully!');
      // Full document navigation so middleware re-evaluates the httpOnly
      // session cookie set by the response above (see login page for detail).
      window.location.assign('/dashboard');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  if (confirmationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center gap-2 mb-2">
              <Hexagon className="size-8 text-emerald-500" />
              <span className="text-2xl font-bold tracking-tight">{PLATFORM.name}</span>
            </div>
            <p className="text-sm text-muted-foreground">Almost there</p>
          </div>

          <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
            <CardHeader className="space-y-1 items-center text-center">
              <MailCheck className="size-10 text-emerald-500 mb-2" />
              <CardTitle className="text-xl">Confirm your email</CardTitle>
              <CardDescription>
                We sent a confirmation link to{' '}
                <span className="font-medium text-foreground">{formData.email}</span>.
                Open it, then sign in to finish setting up{' '}
                <span className="font-medium text-foreground">{formData.organization}</span>.
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-3">
              <Button
                asChild
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                <Link href="/login">Go to sign in</Link>
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                No email after a few minutes? Check your spam folder.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Hexagon className="size-8 text-emerald-500" />
            <span className="text-2xl font-bold tracking-tight">{PLATFORM.name}</span>
          </div>
          <p className="text-sm text-muted-foreground">Create your free account</p>
        </div>

        <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Get started</CardTitle>
            <CardDescription>
              Fill in your details to create a new workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    placeholder="Alex"
                    value={formData.firstName}
                    onChange={(e) => updateField('firstName', e.target.value)}
                    required
                    autoComplete="given-name"
                    disabled={isLoading}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    placeholder="Morgan"
                    value={formData.lastName}
                    onChange={(e) => updateField('lastName', e.target.value)}
                    required
                    autoComplete="family-name"
                    disabled={isLoading}
                    className="h-11"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email address</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@company.com"
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  required
                  autoComplete="email"
                  disabled={isLoading}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a strong password"
                    value={formData.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    disabled={isLoading}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="organization">Organization name</Label>
                <Input
                  id="organization"
                  placeholder="Your company name"
                  value={formData.organization}
                  onChange={(e) => updateField('organization', e.target.value)}
                  required
                  autoComplete="organization"
                  disabled={isLoading}
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter>
            <div className="text-sm text-center text-muted-foreground w-full">
              Already have an account?{' '}
              <Link
                href="/login"
                className="text-emerald-500 hover:text-emerald-600 font-medium"
              >
                Sign in
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}