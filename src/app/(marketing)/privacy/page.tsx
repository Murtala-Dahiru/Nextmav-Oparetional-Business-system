'use client';

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-12">Last updated: January 1, 2025</p>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
            <p>
              NexusCorp Inc. (&quot;NexusCorp,&quot; &quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;) is committed to protecting your privacy. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your information when you use
              our platform, website, and related services (collectively, the &quot;Service&quot;).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
            <h3 className="font-medium mt-4 mb-2">Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Account information: name, email address, password, organization name</li>
              <li>Profile information: job title, department, phone number, profile photo</li>
              <li>Business data: contacts, deals, projects, tasks, financial records, and other content you create within the Service</li>
              <li>Communications: support tickets, feedback, and correspondence with us</li>
            </ul>
            <h3 className="font-medium mt-4 mb-2">Information Collected Automatically</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Usage data: pages visited, features used, time spent, click patterns</li>
              <li>Device information: browser type, operating system, device type, IP address</li>
              <li>Log data: access times, referring URLs, and error logs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide, maintain, and improve the Service</li>
              <li>Process transactions and send related information</li>
              <li>Send technical notices, updates, security alerts, and support messages</li>
              <li>Respond to your comments, questions, and support requests</li>
              <li>Monitor and analyze trends, usage, and activities</li>
              <li>Detect, investigate, and prevent fraudulent or unauthorized activities</li>
              <li>Personalize and improve your experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Data Sharing & Disclosure</h2>
            <p>
              We do not sell your personal information. We may share your information in the
              following circumstances:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>With your organization:</strong> Account administrators may access data within their organization&apos;s workspace as permitted by their role.</li>
              <li><strong>Service providers:</strong> We share information with trusted third-party service providers who assist us in operating the Service (e.g., hosting, analytics, payment processing).</li>
              <li><strong>Legal requirements:</strong> We may disclose information if required by law, regulation, legal process, or governmental request.</li>
              <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including
              encryption at rest and in transit, regular security audits, access controls, and
              monitoring systems. However, no method of electronic storage is 100% secure, and we
              cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Retention</h2>
            <p>
              We retain your personal information for as long as your account is active or as
              needed to provide the Service. If you delete your account, we will delete your
              personal data within 30 days, except where retention is required by law or for
              legitimate business purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your personal information</li>
              <li>Object to or restrict processing of your data</li>
              <li>Data portability (receive your data in a structured format)</li>
              <li>Withdraw consent at any time (where processing is based on consent)</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, please contact us at privacy@nexuscorp.io.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. International Data Transfers</h2>
            <p>
              If you are accessing the Service from outside the United States, please be aware
              that your information may be transferred to, stored, and processed in the United
              States or other countries. We ensure appropriate safeguards are in place for such
              transfers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Children&apos;s Privacy</h2>
            <p>
              The Service is not intended for children under the age of 13. We do not knowingly
              collect personal information from children under 13. If we become aware that we
              have collected personal information from a child under 13, we will take steps to
              delete such information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us:
            </p>
            <div className="mt-2 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-muted-foreground">
              <p>NexusCorp Inc. — Privacy Team</p>
              <p>123 Enterprise Blvd, San Francisco, CA 94105</p>
              <p>Email: privacy@nexuscorp.io</p>
            </div>
          </section>
        </div>
    </div>
  );
}