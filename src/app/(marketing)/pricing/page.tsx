'use client';

import {
  Check,
  Users,
  Zap,
  Shield,
  Headphones,
  BarChart3,
  Globe,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

const plans = [
  {
    name: 'Starter',
    price: '$29',
    period: '/month',
    description: 'Perfect for small teams getting started',
    icon: Zap,
    features: [
      'Up to 5 team members',
      'CRM - up to 500 contacts',
      'Project management - 10 projects',
      'Basic reporting & analytics',
      'Email support',
      '5 GB storage',
      'Basic integrations',
    ],
    limitations: [
      'No HR module',
      'No advanced automations',
      'No custom fields',
    ],
    cta: 'Start free trial',
    recommended: false,
  },
  {
    name: 'Professional',
    price: '$79',
    period: '/month',
    description: 'Best for growing businesses',
    icon: BarChart3,
    features: [
      'Up to 25 team members',
      'CRM - unlimited contacts',
      'Project management - unlimited',
      'Full HR module',
      'Finance & invoicing',
      'Advanced analytics',
      'Custom fields & workflows',
      'Priority email & chat support',
      '50 GB storage',
      'API access',
    ],
    limitations: [],
    cta: 'Start free trial',
    recommended: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations with complex needs',
    icon: Shield,
    features: [
      'Unlimited team members',
      'All Professional features',
      'Advanced security & SSO',
      'Custom integrations & API',
      'Dedicated account manager',
      'Custom onboarding & training',
      'SLA guarantee (99.99%)',
      'Audit logging & compliance',
      'White-label options',
      'Unlimited storage',
    ],
    limitations: [],
    cta: 'Contact sales',
    recommended: false,
  },
];

const comparisonFeatures = [
  { name: 'Team members', starter: '5', professional: '25', enterprise: 'Unlimited' },
  { name: 'CRM contacts', starter: '500', professional: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Projects', starter: '10', professional: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'HR module', starter: false, professional: true, enterprise: true },
  { name: 'Finance & invoicing', starter: false, professional: true, enterprise: true },
  { name: 'Custom workflows', starter: false, professional: true, enterprise: true },
  { name: 'Advanced analytics', starter: false, professional: true, enterprise: true },
  { name: 'API access', starter: false, professional: true, enterprise: true },
  { name: 'Storage', starter: '5 GB', professional: '50 GB', enterprise: 'Unlimited' },
  { name: 'SSO / SAML', starter: false, professional: false, enterprise: true },
  { name: 'Dedicated account manager', starter: false, professional: false, enterprise: true },
  { name: 'SLA guarantee', starter: false, professional: false, enterprise: '99.99%' },
  { name: 'Support', starter: 'Email', professional: 'Priority', enterprise: 'Dedicated' },
];

export default function PricingPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge variant="secondary" className="mb-4">
            Simple, transparent pricing
          </Badge>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            Plans that scale with{' '}
            <span className="text-emerald-500">your business</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Start free for 14 days. No credit card required. Cancel anytime.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mb-24">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <Card
                key={plan.name}
                className={`relative flex flex-col ${
                  plan.recommended
                    ? 'border-emerald-500 shadow-lg shadow-emerald-500/10 scale-[1.02]'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                {plan.recommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-emerald-500 text-white hover:bg-emerald-600">
                      Recommended
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div
                    className={`mx-auto mb-3 rounded-full p-2.5 ${
                      plan.recommended
                        ? 'bg-emerald-500/10'
                        : 'bg-gray-100 dark:bg-gray-800'
                    }`}
                  >
                    <Icon
                      className={`size-5 ${
                        plan.recommended ? 'text-emerald-500' : 'text-muted-foreground'
                      }`}
                    />
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-center pb-2">
                  <div className="flex items-baseline justify-center gap-1 mb-6">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    {plan.period && (
                      <span className="text-muted-foreground text-sm">{plan.period}</span>
                    )}
                  </div>
                  <ul className="space-y-3 text-left mb-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <Check className="size-4 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                    {plan.limitations.map((limitation) => (
                      <li
                        key={limitation}
                        className="flex items-start gap-2.5 text-sm text-muted-foreground"
                      >
                        <span className="mt-1 size-3 rounded-full border border-muted shrink-0" />
                        <span className="line-through">{limitation}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="mt-auto pt-4">
                  <Link href="/signup" className="w-full">
                    <Button
                      className={`w-full h-11 ${
                        plan.recommended
                          ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                          : ''
                      }`}
                      variant={plan.recommended ? 'default' : 'outline'}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Feature Comparison Table */}
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8">
            Compare all features
          </h2>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <th className="text-left py-3.5 px-4 font-medium text-muted-foreground">
                      Feature
                    </th>
                    <th className="text-center py-3.5 px-4 font-medium">Starter</th>
                    <th className="text-center py-3.5 px-4 font-medium text-emerald-500">
                      Professional
                    </th>
                    <th className="text-center py-3.5 px-4 font-medium">Enterprise</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {comparisonFeatures.map((feature) => (
                    <tr key={feature.name} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/50">
                      <td className="py-3 px-4 text-muted-foreground">{feature.name}</td>
                      <td className="py-3 px-4 text-center">
                        {typeof feature.starter === 'boolean' ? (
                          feature.starter ? (
                            <Check className="size-4 text-emerald-500 mx-auto" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : (
                          <span>{feature.starter}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center bg-emerald-500/[0.03]">
                        {typeof feature.professional === 'boolean' ? (
                          feature.professional ? (
                            <Check className="size-4 text-emerald-500 mx-auto" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : (
                          <span className="font-medium">{feature.professional}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {typeof feature.enterprise === 'boolean' ? (
                          feature.enterprise ? (
                            <Check className="size-4 text-emerald-500 mx-auto" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : (
                          <span>{feature.enterprise}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Trust Section */}
        <div className="mt-24 text-center">
          <div className="flex flex-wrap items-center justify-center gap-8 text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="size-5 text-emerald-500" />
              <span className="text-sm">SOC 2 Compliant</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-5 text-emerald-500" />
              <span className="text-sm">99.9% Uptime SLA</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="size-5 text-emerald-500" />
              <span className="text-sm">Global CDN</span>
            </div>
            <div className="flex items-center gap-2">
              <Headphones className="size-5 text-emerald-500" />
              <span className="text-sm">24/7 Support</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="size-5 text-emerald-500" />
              <span className="text-sm">10,000+ Teams</span>
            </div>
          </div>
        </div>
    </div>
  );
}