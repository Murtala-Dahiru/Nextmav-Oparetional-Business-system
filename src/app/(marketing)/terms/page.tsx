'use client';

import { LEGAL_EMAIL } from '@/lib/public-contact';

export default function TermsPage() {
  return (
    <div className="nm-legal">
        <h1 className="nm-legal-title">Terms of Service</h1>
        <p className="nm-legal-meta">Last updated: January 1, 2025</p>

        <div className="nm-legal-body">
          <section>
            <h2 className="nm-legal-h2">1. Acceptance of Terms</h2>
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
            <h2 className="nm-legal-h2">2. Description of Service</h2>
            <p>
              NextMav provides a cloud-based business operating system that includes customer
              relationship management (CRM), project management, human resources management,
              financial management, inventory management, and related features. The Service is
              provided &quot;as is&quot; and &quot;as available&quot; basis.
            </p>
          </section>

          <section>
            <h2 className="nm-legal-h2">3. User Accounts</h2>
            <p>
              To use certain features of the Service, you must create an account. You are
              responsible for maintaining the confidentiality of your account credentials and for
              all activities that occur under your account. You agree to:
            </p>
            <ul className="nm-legal-list">
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain and promptly update your account information</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
              <li>Not share your account credentials with any third party</li>
            </ul>
          </section>

          <section>
            <h2 className="nm-legal-h2">4. Subscription & Payments</h2>
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
            <h2 className="nm-legal-h2">5. Acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="nm-legal-list">
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe upon the rights of any third party</li>
              <li>Distribute spam, malware, or other harmful content</li>
              <li>Attempt to gain unauthorized access to the Service or related systems</li>
              <li>Use the Service for any purpose that is unlawful or prohibited by these Terms</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="nm-legal-h2">6. Intellectual Property</h2>
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
            <h2 className="nm-legal-h2">7. Data Protection</h2>
            <p>
              We take data protection seriously. Our collection and use of personal information
              in connection with the Service is as described in our Privacy Policy. By using the
              Service, you consent to the collection and use of your information as outlined
              therein.
            </p>
          </section>

          <section>
            <h2 className="nm-legal-h2">8. Limitation of Liability</h2>
            <p>
              In no event shall NextMav, its directors, employees, partners, agents, suppliers,
              or affiliates be liable for any indirect, incidental, special, consequential, or
              punitive damages, including loss of profits, data, or other intangible losses,
              resulting from your access to or use of (or inability to access or use) the Service.
            </p>
          </section>

          <section>
            <h2 className="nm-legal-h2">9. Termination</h2>
            <p>
              We may terminate or suspend your account immediately, without prior notice, for
              conduct that we determine, in our sole discretion, violates these Terms, is harmful
              to other users or the Service, or for any other reason we deem appropriate.
            </p>
          </section>

          <section>
            <h2 className="nm-legal-h2">10. Contact</h2>
            <p>
              If you have any questions about these Terms, please contact us at:
            </p>
            <div className="nm-legal-callout">
              <p>NextMav Inc.</p>
              <p>Email: {LEGAL_EMAIL}</p>
            </div>
          </section>
        </div>
    </div>
  );
}