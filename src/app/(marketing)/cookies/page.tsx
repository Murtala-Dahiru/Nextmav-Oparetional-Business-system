'use client';

export default function CookiesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Cookie Policy</h1>
        <p className="text-sm text-muted-foreground mb-12">Last updated: January 1, 2025</p>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. What Are Cookies?</h2>
            <p>
              Cookies are small text files that are stored on your device (computer, tablet, or
              mobile phone) when you visit a website. They are widely used to make websites work
              more efficiently, provide a better user experience, and supply information to the
              website owners.
            </p>
            <p className="mt-3">
              This Cookie Policy explains how NextMav Inc. (&quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;) uses cookies and similar technologies when you visit and interact
              with our platform and website (the &quot;Service&quot;).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. How We Use Cookies</h2>
            <p>
              We use cookies for the following purposes:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Essential cookies:</strong> Required for the Service to function properly, including authentication, security, and session management.</li>
              <li><strong>Functionality cookies:</strong> Remember your preferences and settings to provide a personalized experience (e.g., language, theme, layout preferences).</li>
              <li><strong>Analytics cookies:</strong> Help us understand how visitors interact with the Service by collecting and reporting information anonymously.</li>
              <li><strong>Performance cookies:</strong> Collect information about how pages perform and are used, helping us improve the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Types of Cookies We Use</h2>

            <h3 className="font-medium mt-4 mb-2">Strictly Necessary Cookies</h3>
            <p>These cookies are essential for the Service to function. They cannot be disabled.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <th className="text-left py-2 px-3 font-medium">Cookie</th>
                    <th className="text-left py-2 px-3 font-medium">Purpose</th>
                    <th className="text-left py-2 px-3 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr>
                    <td className="py-2 px-3 font-mono text-xs">nexus_session</td>
                    <td className="py-2 px-3">Maintains your logged-in session</td>
                    <td className="py-2 px-3">Session</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono text-xs">nexus_csrf</td>
                    <td className="py-2 px-3">Prevents cross-site request forgery attacks</td>
                    <td className="py-2 px-3">Session</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono text-xs">nexus_prefs</td>
                    <td className="py-2 px-3">Stores your theme and display preferences</td>
                    <td className="py-2 px-3">1 year</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="font-medium mt-6 mb-2">Analytics Cookies</h3>
            <p>
              These cookies help us understand how visitors use the Service. The information is
              collected and aggregated anonymously.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <th className="text-left py-2 px-3 font-medium">Cookie</th>
                    <th className="text-left py-2 px-3 font-medium">Purpose</th>
                    <th className="text-left py-2 px-3 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr>
                    <td className="py-2 px-3 font-mono text-xs">_ga</td>
                    <td className="py-2 px-3">Distinguishes unique visitors (Google Analytics)</td>
                    <td className="py-2 px-3">2 years</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono text-xs">_ga_*</td>
                    <td className="py-2 px-3">Maintains session state (Google Analytics 4)</td>
                    <td className="py-2 px-3">2 years</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono text-xs">nexus_anon_id</td>
                    <td className="py-2 px-3">Anonymized identifier for internal analytics</td>
                    <td className="py-2 px-3">2 years</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Managing Your Cookie Preferences</h2>
            <p>
              You can control and manage cookies in several ways. Please note that removing or
              blocking cookies may impact your user experience and parts of the Service may no
              longer be fully accessible.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Browser settings:</strong> Most browsers allow you to control cookies through their settings. Check your browser&apos;s help documentation for instructions.</li>
              <li><strong>Opt-out tools:</strong> You can opt out of Google Analytics tracking by installing the Google Analytics opt-out browser add-on.</li>
              <li><strong>Cookie banner:</strong> When you first visit the Service, you will be presented with a cookie consent banner where you can accept or customize your cookie preferences.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Similar Technologies</h2>
            <p>
              In addition to cookies, we may use similar technologies such as:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Local Storage:</strong> Similar to cookies but can store larger amounts of data. Used for caching and offline functionality.</li>
              <li><strong>Pixel tags / Web beacons:</strong> Small transparent images used to track page views and email opens.</li>
              <li><strong>Fingerprinting:</strong> Device characteristics used for fraud prevention and security purposes only.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Changes to This Policy</h2>
            <p>
              We may update this Cookie Policy from time to time to reflect changes in technology,
              legislation, or our data collection practices. We will notify you of any material
              changes by posting the updated policy on this page and updating the &quot;Last
              updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Contact Us</h2>
            <p>
              If you have any questions about our use of cookies, please contact us:
            </p>
            <div className="mt-2 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-muted-foreground">
              <p>NextMav Inc. — Privacy Team</p>
              <p>Email: privacy@example.com</p>
            </div>
          </section>
        </div>
    </div>
  );
}