'use client';

import { useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  Copy,
  Check,
  Terminal,
  Key,
  Webhook,
  FileCode2,
  Rocket,
  UserPlus,
  Settings,
  Database,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

type SectionId = 'getting-started' | 'authentication' | 'api-reference' | 'webhooks';

const sidebarNav = [
  {
    section: 'Getting Started',
    id: 'getting-started' as SectionId,
    icon: Rocket,
    items: ['Installation', 'Quick Start', 'Configuration'],
  },
  {
    section: 'Authentication',
    id: 'authentication' as SectionId,
    icon: Key,
    items: ['API Keys', 'OAuth 2.0', 'Token Management'],
  },
  {
    section: 'API Reference',
    id: 'api-reference' as SectionId,
    icon: FileCode2,
    items: ['Endpoints', 'Request Format', 'Response Format', 'Error Codes', 'Rate Limiting'],
  },
  {
    section: 'Webhooks',
    id: 'webhooks' as SectionId,
    icon: Webhook,
    items: ['Setup', 'Event Types', 'Payload Format', 'Retry Logic'],
  },
];

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden my-4">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-medium text-muted-foreground">{language}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3 mr-1" /> : <Copy className="size-3 mr-1" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="bg-muted p-4 overflow-x-auto">
        <code className="text-sm font-mono leading-relaxed">{code}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('getting-started');
  const [activeItem, setActiveItem] = useState<string>('Installation');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Breadcrumbs */}
      <Breadcrumb className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Documentation</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-24">
            <ScrollArea className="h-[calc(100vh-8rem)]">
              <nav aria-label="Documentation navigation" className="space-y-1 pr-4">
                {sidebarNav.map((section) => {
                  const Icon = section.icon;
                  const isSectionActive = activeSection === section.id;
                  return (
                    <div key={section.id} className="mb-4">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSection(section.id);
                          setActiveItem(section.items[0]);
                        }}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                          isSectionActive
                            ? 'text-emerald-500 bg-emerald-500/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Icon className="size-4 shrink-0" />
                        {section.section}
                      </button>
                      {isSectionActive && (
                        <ul className="ml-4 mt-1 space-y-0.5 border-l border-gray-200 dark:border-gray-800 pl-3">
                          {section.items.map((item) => (
                            <li key={item}>
                              <button
                                type="button"
                                onClick={() => setActiveItem(item)}
                                className={`block w-full text-left px-2.5 py-1.5 text-sm rounded-md transition-colors ${
                                  activeItem === item
                                    ? 'text-emerald-500 font-medium bg-emerald-500/5'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800'
                                }`}
                              >
                                {item}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </nav>
            </ScrollArea>
          </div>
        </aside>

        {/* Mobile section selector */}
        <div className="lg:hidden w-full mb-6">
          <ScrollArea className="w-full">
            <div className="flex gap-2 pb-2">
              {sidebarNav.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(section.id);
                      setActiveItem(section.items[0]);
                    }}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border whitespace-nowrap shrink-0 transition-colors ${
                      activeSection === section.id
                        ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10'
                        : 'border-gray-200 dark:border-gray-800 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="size-4" />
                    {section.section}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {activeSection === 'getting-started' && (
            <article>
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center">
                  <Rocket className="size-5 text-emerald-500" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    Getting Started
                  </h1>
                  <p className="text-sm text-muted-foreground">Set up and configure your NexusCorp integration</p>
                </div>
              </div>

              <Separator className="my-6" />

              <section id="installation" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Installation</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  Install the NexusCorp SDK using your preferred package manager. The SDK provides
                  convenient wrappers around our REST API and handles authentication automatically.
                </p>
                <CodeBlock
                  language="bash"
                  code={`# Using npm
npm install @nexuscorp/sdk

# Using yarn
yarn add @nexuscorp/sdk

# Using bun
bun add @nexuscorp/sdk`}
                />
              </section>

              <section id="quick-start" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Quick Start</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  Initialize the SDK with your API key and start making requests. You can find your
                  API key in the Dashboard under Settings &gt; API Keys.
                </p>
                <CodeBlock
                  language="typescript"
                  code={`import { NexusCorp } from '@nexuscorp/sdk';

const client = new NexusCorp({
  apiKey: process.env.NEXUSCORP_API_KEY,
  workspace: 'your-workspace-id',
});

// Fetch all contacts
const contacts = await client.crm.contacts.list({
  limit: 50,
  sort: 'created_at',
  order: 'desc',
});

console.log(\`Found \${contacts.data.length} contacts\`);`}
                />
              </section>

              <section id="configuration" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Configuration</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  The SDK supports several configuration options for customizing behavior:
                </p>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left py-3 px-4 font-medium">Option</th>
                        <th className="text-left py-3 px-4 font-medium">Type</th>
                        <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Default</th>
                        <th className="text-left py-3 px-4 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {[
                        ['apiKey', 'string', 'required', 'Your API key for authentication'],
                        ['workspace', 'string', 'required', 'Workspace ID to operate in'],
                        ['baseUrl', 'string', "'https://api.nexuscorp.io'", 'Custom API endpoint'],
                        ['timeout', 'number', '30000', 'Request timeout in milliseconds'],
                        ['retries', 'number', '3', 'Number of retry attempts on failure'],
                      ].map(([name, type, def, desc]) => (
                        <tr key={name} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-emerald-500">{name}</td>
                          <td className="py-3 px-4 text-muted-foreground">{type}</td>
                          <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell font-mono text-xs">{def}</td>
                          <td className="py-3 px-4 text-muted-foreground">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </article>
          )}

          {activeSection === 'authentication' && (
            <article>
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center">
                  <Key className="size-5 text-emerald-500" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    Authentication
                  </h1>
                  <p className="text-sm text-muted-foreground">Securely authenticate API requests</p>
                </div>
              </div>

              <Separator className="my-6" />

              <section id="api-keys" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">API Keys</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  All API requests require authentication via an API key passed in the Authorization header.
                  API keys are workspace-scoped and can be created from your Dashboard settings.
                </p>
                <CodeBlock
                  language="bash"
                  code={`curl -X GET https://api.nexuscorp.io/v1/contacts \\
  -H "Authorization: Bearer nc_live_abc123def456" \\
  -H "Content-Type: application/json"`}
                />
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 mt-4">
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    <strong>Warning:</strong> Never expose your API key in client-side code or public repositories.
                    Use environment variables to store keys securely.
                  </p>
                </div>
              </section>

              <section id="oauth" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">OAuth 2.0</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  For third-party integrations, NexusCorp supports OAuth 2.0 authorization code flow.
                  Users authorize your app to access their data without sharing credentials.
                </p>
                <CodeBlock
                  language="typescript"
                  code={`// Step 1: Redirect user to authorization URL
const authUrl = new URL('https://app.nexuscorp.io/oauth/authorize');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'crm:read crm:write projects:read');

// Step 2: Exchange authorization code for access token
const tokenResponse = await fetch('https://api.nexuscorp.io/oauth/token', {
  method: 'POST',
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code: authorizationCode,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  }),
});`}
                />
              </section>

              <section id="token-management" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Token Management</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  Access tokens expire after 1 hour. Use the refresh token to obtain new access tokens
                  without requiring user interaction.
                </p>
                <CodeBlock
                  language="bash"
                  code={`# Refresh an expired access token
curl -X POST https://api.nexuscorp.io/oauth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "rt_abc123...",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret"
  }'`}
                />
              </section>
            </article>
          )}

          {activeSection === 'api-reference' && (
            <article>
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center">
                  <FileCode2 className="size-5 text-emerald-500" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    API Reference
                  </h1>
                  <p className="text-sm text-muted-foreground">Complete REST API endpoint documentation</p>
                </div>
              </div>

              <Separator className="my-6" />

              <section id="endpoints" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Endpoints</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  The base URL for all API requests is <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">https://api.nexuscorp.io/v1</code>.
                  All requests must use HTTPS.
                </p>
                <div className="space-y-3">
                  {[
                    { method: 'GET', path: '/contacts', desc: 'List all contacts' },
                    { method: 'POST', path: '/contacts', desc: 'Create a new contact' },
                    { method: 'GET', path: '/contacts/:id', desc: 'Get a specific contact' },
                    { method: 'PATCH', path: '/contacts/:id', desc: 'Update a contact' },
                    { method: 'DELETE', path: '/contacts/:id', desc: 'Delete a contact' },
                    { method: 'GET', path: '/deals', desc: 'List all deals' },
                    { method: 'POST', path: '/deals', desc: 'Create a new deal' },
                    { method: 'GET', path: '/projects', desc: 'List all projects' },
                    { method: 'POST', path: '/projects', desc: 'Create a new project' },
                  ].map((endpoint) => (
                    <div
                      key={`${endpoint.method}-${endpoint.path}`}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3 hover:border-emerald-500/50 transition-colors"
                    >
                      <Badge
                        variant="secondary"
                        className={`font-mono text-xs shrink-0 ${
                          endpoint.method === 'GET'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : endpoint.method === 'POST'
                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            : endpoint.method === 'PATCH'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {endpoint.method}
                      </Badge>
                      <code className="text-sm font-mono text-foreground">{endpoint.path}</code>
                      <span className="text-sm text-muted-foreground ml-auto hidden sm:block">{endpoint.desc}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section id="request-format" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Request Format</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  All POST and PATCH requests should send JSON in the request body with the
                  <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">Content-Type: application/json</code> header.
                </p>
                <CodeBlock
                  language="json"
                  code={`{
  "data": {
    "first_name": "Amara",
    "last_name": "Ekwueme",
    "email": "a.ekwueme@northgate-logistics.com",
    "company": "Northgate Logistics",
    "tags": ["vip", "enterprise"]
  }
}`}
                />
              </section>

              <section id="response-format" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Response Format</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  All responses follow a consistent envelope format with data, meta, and error fields.
                </p>
                <CodeBlock
                  language="json"
                  code={`{
  "data": [
    {
      "id": "con_abc123",
      "first_name": "Amara",
      "last_name": "Ekwueme",
      "email": "a.ekwueme@northgate-logistics.com",
      "created_at": "2024-01-15T09:30:00Z",
      "updated_at": "2024-01-15T09:30:00Z"
    }
  ],
  "meta": {
    "total": 142,
    "page": 1,
    "per_page": 50,
    "has_more": true
  }
}`}
                />
              </section>

              <section id="error-codes" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Error Codes</h2>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left py-3 px-4 font-medium">Code</th>
                        <th className="text-left py-3 px-4 font-medium">Name</th>
                        <th className="text-left py-3 px-4 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {[
                        ['400', 'Bad Request', 'The request body is malformed or missing required fields'],
                        ['401', 'Unauthorized', 'Invalid or missing API key'],
                        ['403', 'Forbidden', 'Insufficient permissions for the requested resource'],
                        ['404', 'Not Found', 'The requested resource does not exist'],
                        ['429', 'Rate Limited', 'Too many requests. Retry after the specified time'],
                        ['500', 'Server Error', 'An unexpected error occurred on our end'],
                      ].map(([code, name, desc]) => (
                        <tr key={code} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs">{code}</td>
                          <td className="py-3 px-4 font-medium">{name}</td>
                          <td className="py-3 px-4 text-muted-foreground">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section id="rate-limiting" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Rate Limiting</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  API rate limits vary by plan. Limits are applied per workspace and reset every minute.
                  Rate limit info is included in response headers.
                </p>
                <CodeBlock
                  language="bash"
                  code={`# Response headers include rate limit information
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 997
X-RateLimit-Reset: 1704067200`}
                />
              </section>
            </article>
          )}

          {activeSection === 'webhooks' && (
            <article>
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center">
                  <Webhook className="size-5 text-emerald-500" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    Webhooks
                  </h1>
                  <p className="text-sm text-muted-foreground">Real-time event notifications</p>
                </div>
              </div>

              <Separator className="my-6" />

              <section id="webhook-setup" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Setup</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  Configure webhooks in your Dashboard under Settings &gt; Webhooks, or use the API
                  to register webhook endpoints programmatically.
                </p>
                <CodeBlock
                  language="bash"
                  code={`# Register a new webhook endpoint
curl -X POST https://api.nexuscorp.io/v1/webhooks \\
  -H "Authorization: Bearer nc_live_abc123def456" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-app.com/api/webhooks/nexuscorp",
    "events": ["contact.created", "deal.updated", "project.completed"],
    "secret": "whsec_your_signing_secret"
  }'`}
                />
              </section>

              <section id="event-types" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Event Types</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { category: 'CRM', events: ['contact.created', 'contact.updated', 'deal.created', 'deal.stage_changed'] },
                    { category: 'Projects', events: ['project.created', 'task.completed', 'project.archived'] },
                    { category: 'Finance', events: ['invoice.created', 'invoice.paid', 'expense.approved'] },
                    { category: 'System', events: ['user.invited', 'workspace.updated', 'webhook.failed'] },
                  ].map((group) => (
                    <div key={group.category} className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
                      <h3 className="text-sm font-medium mb-2">{group.category}</h3>
                      <div className="space-y-1.5">
                        {group.events.map((event) => (
                          <code key={event} className="block text-xs font-mono text-muted-foreground">
                            {event}
                          </code>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section id="payload-format" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Payload Format</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  Webhook payloads include the event type, timestamp, and the full resource object.
                  Each payload is signed with HMAC-SHA256 using your webhook secret.
                </p>
                <CodeBlock
                  language="json"
                  code={`{
  "id": "evt_abc123def456",
  "type": "contact.created",
  "timestamp": "2024-01-15T09:30:00Z",
  "data": {
    "id": "con_xyz789",
    "first_name": "Amara",
    "last_name": "Ekwueme",
    "email": "a.ekwueme@northgate-logistics.com",
    "workspace_id": "ws_abc123"
  },
  "signature": "sha256=a1b2c3d4e5f6..."
}`}
                />
              </section>

              <section id="retry-logic" className="mb-10">
                <h2 className="text-xl font-semibold mb-4">Retry Logic</h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  If your endpoint does not respond with a 2xx status code, we will retry delivery
                  using an exponential backoff strategy.
                </p>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left py-3 px-4 font-medium">Attempt</th>
                        <th className="text-left py-3 px-4 font-medium">Delay</th>
                        <th className="text-left py-3 px-4 font-medium">Max Delay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {[
                        ['1st retry', '1 minute', '—'],
                        ['2nd retry', '5 minutes', '—'],
                        ['3rd retry', '15 minutes', '—'],
                        ['4th retry', '1 hour', '—'],
                        ['5th retry', '6 hours', '—'],
                        ['6th+ retry', '12 hours', '72 hours'],
                      ].map(([attempt, delay, max]) => (
                        <tr key={attempt} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4">{attempt}</td>
                          <td className="py-3 px-4 text-muted-foreground">{delay}</td>
                          <td className="py-3 px-4 text-muted-foreground">{max}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
