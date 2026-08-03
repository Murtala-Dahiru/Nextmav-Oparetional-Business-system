'use client';

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-12">Last updated: January 1, 2025</p>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the NextMav platform (&quot;Service&quot;), you agree to be
              bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these
              Terms, you may not access or use the Service. These Terms apply to all visitors,
              users, and others who access or use the Service.
            </p>
            <p className="mt-3">
              NextMav Inc. (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;) reserves the right to update or modify these Terms at any time
              without prior notice. Your continued use of the Service after any such changes
              constitutes your acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
            <p>
              NextMav provides a cloud-based business operating system that includes customer
              relationship management (CRM), project management, human resources management,
              financial management, inventory management, and related features. The Service is
              provided &quot;as is&quot; and &quot;as available&quot; basis.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. User Accounts</h2>
            <p>
              To use certain features of the Service, you must create an account. You are
              responsible for maintaining the confidentiality of your account credentials and for
              all activities that occur under your account. You agree to:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain and promptly update your account information</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
              <li>Not share your account credentials with any third party</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Subscription & Payments</h2>
            <p>
              The Service is offered on a subscription basis with various plan tiers. By
              subscribing, you authorize us to charge the applicable fees to your payment method.
              Subscription fees are billed in advance on a monthly or annual basis, depending on
              your selected plan.
            </p>
            <p className="mt-3">
              You may cancel your subscription at any time. Upon cancellation, you will retain
              access to the Service until the end of your current billing period. We do not
              provide refunds for partial billing periods.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe upon the rights of any third party</li>
              <li>Distribute spam, malware, or other harmful content</li>
              <li>Attempt to gain unauthorized access to the Service or related systems</li>
              <li>Use the Service for any purpose that is unlawful or prohibited by these Terms</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Intellectual Property</h2>
            <p>
              The Service and its original content (excluding content provided by users) remain
              the exclusive property of NextMav and its licensors. The Service is protected by
              copyright, trademark, and other laws. Our trademarks and trade dress may not be used
              in connection with any product or service without prior written consent.
            </p>
            <p className="mt-3">
              You retain all rights to any content you submit, post, or display on or through the
              Service. By submitting content, you grant us a worldwide, non-exclusive,
              royalty-free license to use, reproduce, and process such content solely for the
              purpose of providing the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Data Protection</h2>
            <p>
              We take data protection seriously. Our collection and use of personal information
              in connection with the Service is as described in our Privacy Policy. By using the
              Service, you consent to the collection and use of your information as outlined
              therein.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Limitation of Liability</h2>
            <p>
              In no event shall NextMav, its directors, employees, partners, agents, suppliers,
              or affiliates be liable for any indirect, incidental, special, consequential, or
              punitive damages, including loss of profits, data, or other intangible losses,
              resulting from your access to or use of (or inability to access or use) the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Termination</h2>
            <p>
              We may terminate or suspend your account immediately, without prior notice, for
              conduct that we determine, in our sole discretion, violates these Terms, is harmful
              to other users or the Service, or for any other reason we deem appropriate.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Contact</h2>
            <p>
              If you have any questions about these Terms, please contact us at:
            </p>
            <div className="mt-2 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-muted-foreground">
              <p>NextMav Inc.</p>
              <p>Email: legal@example.com</p>
            </div>
          </section>
        </div>
    </div>
  );
}