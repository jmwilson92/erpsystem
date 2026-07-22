/**
 * Legal document content for the hosted service. These are solid, tailored
 * starting templates — NOT a substitute for review by a licensed attorney,
 * especially the DPA, export-control (ITAR/EAR) terms, and anything touching
 * regulated customer data. Replace bracketed placeholders and the contact/
 * jurisdiction details before going live.
 */

export const LEGAL_COMPANY = "ForgeRP";
export const LEGAL_ENTITY = "[Your Legal Entity, LLC]";
export const LEGAL_JURISDICTION = "[State], United States";
export const LEGAL_CONTACT = "legal@forgerp.example";
export const PRIVACY_CONTACT = "privacy@forgerp.example";
export const LAST_UPDATED = "2026-07-22";

export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalDoc = {
  slug: string;
  title: string;
  summary: string;
  sections: LegalSection[];
};

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms-of-service",
    title: "Terms of Service",
    summary: "The agreement governing your use of the hosted service.",
    sections: [
      {
        heading: "1. Agreement",
        paragraphs: [
          `These Terms of Service ("Terms") are a binding agreement between ${LEGAL_ENTITY} ("${LEGAL_COMPANY}", "we", "us") and the organization or person that creates an account ("Customer", "you"). By creating an account, clicking to accept, or using the Service, you agree to these Terms. If you accept on behalf of an organization, you represent that you are authorized to bind it.`,
        ],
      },
      {
        heading: "2. The Service",
        paragraphs: [
          `${LEGAL_COMPANY} is a hosted manufacturing ERP provided as software-as-a-service ("Service"). Each Customer is provisioned an isolated instance; your business data is stored in your own instance's database and is not commingled with other customers' data.`,
          "We may update, improve, or modify features over time. We will not materially reduce the core functionality of a paid plan during a paid term without notice.",
        ],
      },
      {
        heading: "3. Trials and beta",
        paragraphs: [
          "Free trials run for the stated period (currently 30 days) with the features described at signup. Beta or early-access features are provided on an as-is basis and may change or be withdrawn. Keep independent records of anything business-critical.",
        ],
      },
      {
        heading: "4. Fees, billing, and refunds",
        paragraphs: [
          "Paid plans are billed annually in advance based on your selected tier and organization size. Unless you cancel before the trial ends, the payment method on file is charged for the first annual term when the trial concludes.",
          "You may request a full refund of the initial annual charge within 30 days of that charge. Renewals are not pro-rated or refundable except where required by law. Fees are exclusive of taxes, which you are responsible for.",
        ],
      },
      {
        heading: "5. Your responsibilities",
        paragraphs: [
          "You are responsible for your users, for keeping credentials secure, for the accuracy of data you enter, and for using the Service in compliance with law. You must not misuse the Service (see the Acceptable Use Policy).",
          "You are responsible for validating any output before relying on it in regulated, safety-critical, or financial contexts. The Service supports your processes; it does not replace your professional judgment or independent controls.",
        ],
      },
      {
        heading: "6. Export control",
        paragraphs: [
          "The hosted Service is intended for business records that are not subject to export control. You agree not to upload data controlled under ITAR (22 CFR 120-130) or EAR (15 CFR 730-774) to the standard hosted Service. Customers with export-controlled data must use a compliant deployment (self-hosted or an Enterprise offering designated for that purpose). You are responsible for your own export-control compliance.",
        ],
      },
      {
        heading: "7. Intellectual property",
        paragraphs: [
          `We and our licensors own the Service and all related IP. You own your data. You grant us a limited license to host and process your data solely to provide and support the Service.`,
        ],
      },
      {
        heading: "8. Warranty disclaimer",
        paragraphs: [
          'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE MAXIMUM EXTENT PERMITTED BY LAW.',
        ],
      },
      {
        heading: "9. Limitation of liability",
        paragraphs: [
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE FEES YOU PAID IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM.",
        ],
      },
      {
        heading: "10. Term, suspension, and termination",
        paragraphs: [
          "These Terms apply while you use the Service. We may suspend access for non-payment, security risk, or material breach. On termination you may export your data for 30 days, after which we may delete it.",
        ],
      },
      {
        heading: "11. Governing law and changes",
        paragraphs: [
          `These Terms are governed by the laws of ${LEGAL_JURISDICTION}, without regard to conflict-of-laws rules. We may update these Terms; material changes take effect on notice. Questions: ${LEGAL_CONTACT}.`,
        ],
      },
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    summary: "What personal data we process, why, and your rights.",
    sections: [
      {
        heading: "1. Scope",
        paragraphs: [
          `This Policy explains how ${LEGAL_COMPANY} handles personal data for the hosted Service. For business records you enter, you are the controller and we are your processor (see the Data Processing Addendum).`,
        ],
      },
      {
        heading: "2. Data we process",
        paragraphs: [
          "Account data: names, work emails, roles, and authentication data. Passwords are stored only as salted scrypt hashes — never in plaintext.",
          "Customer content: the business records you enter (orders, parts, work orders, HR and onboarding records, etc.). For HR/onboarding this can include employee personal information you choose to store.",
          "Usage and audit data: actions are audit-logged (who did what, when) as a core ERP control, along with limited technical logs for security and reliability.",
        ],
      },
      {
        heading: "3. How we use it",
        paragraphs: [
          "We process data to provide, secure, support, and improve the Service, to bill you, and to meet legal obligations. We do not sell personal data and do not use your customer content for advertising.",
        ],
      },
      {
        heading: "4. Sharing and subprocessors",
        paragraphs: [
          "We share data only with infrastructure providers needed to run the Service (hosting, email delivery, payment processing, optional bank-connection and text-to-speech providers you enable). See the Subprocessors page for the current list.",
        ],
      },
      {
        heading: "5. Retention and security",
        paragraphs: [
          "We retain customer content for the life of your account and for a limited window after termination so you can export it. We apply access controls, encryption in transit, and least-privilege practices. No system is perfectly secure; report concerns to us promptly.",
        ],
      },
      {
        heading: "6. Your rights (GDPR / CCPA-CPRA)",
        paragraphs: [
          `Depending on your location you may have rights to access, correct, delete, or export personal data, and to object to or restrict certain processing. For customer content, direct requests to your organization's admin (the controller). For account data, contact ${PRIVACY_CONTACT}. We respond to verified requests within the timeframes required by law (generally within 30-45 days).`,
          "We do not sell or share personal information as defined by the CCPA/CPRA.",
        ],
      },
      {
        heading: "7. International transfers and children",
        paragraphs: [
          "The hosted Service is operated from the United States. Where required, we rely on appropriate transfer mechanisms. The Service is for business use and not directed to children under 16.",
        ],
      },
    ],
  },
  {
    slug: "dpa",
    title: "Data Processing Addendum",
    summary: "Controller-processor terms for customer personal data (GDPR/CCPA).",
    sections: [
      {
        heading: "1. Roles",
        paragraphs: [
          `This Addendum forms part of the Terms. For personal data contained in customer content, Customer is the controller/business and ${LEGAL_COMPANY} is the processor/service provider, processing only on Customer's documented instructions to provide the Service.`,
        ],
      },
      {
        heading: "2. Processor obligations",
        paragraphs: [
          "We will: (a) process personal data only to provide the Service and as instructed; (b) ensure personnel are bound by confidentiality; (c) implement appropriate technical and organizational security measures; (d) not sell or share personal data; (e) assist you with data-subject requests and, to the extent applicable, with DPIAs and regulator inquiries.",
        ],
      },
      {
        heading: "3. Subprocessors",
        paragraphs: [
          "You authorize the subprocessors listed on the Subprocessors page. We remain responsible for their performance and will give notice of material changes, giving you an opportunity to object.",
        ],
      },
      {
        heading: "4. Data-subject requests, breach, deletion",
        paragraphs: [
          "We will notify you without undue delay after becoming aware of a personal-data breach affecting your data, and will support your notification obligations. On termination, we delete or return personal data per the Terms and your instructions, subject to legal retention requirements.",
        ],
      },
      {
        heading: "5. International transfers",
        paragraphs: [
          "Where personal data is transferred across borders, the parties will rely on a lawful transfer mechanism (e.g., Standard Contractual Clauses) where required.",
        ],
      },
    ],
  },
  {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    summary: "What you may not do with the Service.",
    sections: [
      {
        heading: "Prohibited uses",
        paragraphs: [
          "You may not use the Service to: break the law or infringe others' rights; upload malware or attempt to breach security or access other customers' instances; reverse engineer except as permitted by law; send spam or unlawful communications; upload export-controlled (ITAR/EAR) data to the standard hosted Service; or use the Service to build a competing product by copying it.",
          "You may not overload or interfere with the Service's infrastructure, probe or scan it without authorization, or circumvent usage limits, authentication, or billing.",
        ],
      },
      {
        heading: "Enforcement",
        paragraphs: [
          "We may investigate suspected violations and suspend or terminate access for conduct we reasonably believe violates this Policy or creates risk to us or other customers.",
        ],
      },
    ],
  },
  {
    slug: "subprocessors",
    title: "Subprocessors",
    summary: "Third parties that may process data to run the Service.",
    sections: [
      {
        heading: "Current subprocessors",
        paragraphs: [
          "Hosting/infrastructure: [your cloud provider] — application and database hosting (United States).",
          "Payment processing: Stripe — subscription billing and card processing. Card data is handled by Stripe; we do not store full card numbers.",
          "Email delivery: [your email/SMTP provider] — transactional and notification email.",
          "Bank connectivity (optional, if you enable it): Plaid — read-only bank transaction feeds you connect.",
          "Text-to-speech (optional, if you enable guided-tour voice): the TTS provider you configure (e.g., xAI/Grok or OpenAI).",
        ],
      },
      {
        heading: "Self-hosted deployments",
        paragraphs: [
          "If you run a self-hosted or desktop deployment, data stays in your environment and these subprocessors do not apply except for any integrations you choose to enable.",
        ],
      },
    ],
  },
  {
    slug: "cookie-policy",
    title: "Cookie Policy",
    summary: "The small number of cookies the app uses.",
    sections: [
      {
        heading: "Cookies we use",
        paragraphs: [
          "Session cookie (essential): keeps you signed in. Strictly necessary; the app does not work without it.",
          "Preference storage: your theme and guided-tour voice preference are stored locally in your browser, not for tracking.",
          "We do not use third-party advertising or cross-site tracking cookies.",
        ],
      },
    ],
  },
  {
    slug: "refund-policy",
    title: "Refund Policy",
    summary: "Trials, the first annual charge, and renewals.",
    sections: [
      {
        heading: "Trials and the first charge",
        paragraphs: [
          "The 30-day trial is free and requires no payment to start using. When the trial ends, the annual plan you selected is charged to your payment method.",
          "You may request a full refund of that initial annual charge within 30 days of the charge — contact billing and we'll process it. After 30 days, the annual term is non-refundable except where required by law.",
        ],
      },
      {
        heading: "Renewals and cancellation",
        paragraphs: [
          "Annual plans renew automatically. Cancel before the renewal date to avoid the next charge. Renewals are not pro-rated. Canceling stops future billing; you keep access through the paid term.",
        ],
      },
    ],
  },
];

export function getLegalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}
