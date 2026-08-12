import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Clock3, Printer, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/button";
import { PublicPageShell } from "../../components/public/PublicPageShell";

type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[]; subheading?: string };

const terms: LegalSection[] = [
  { title: "Introduction & Acceptance of Terms", paragraphs: ['Welcome to PeAS (Paulinian electronic Archiving System)! These Terms and Conditions ("Terms") govern your access to and use of our website, services, and applications (collectively, the "Service"). By accessing or using the Service, you signify your agreement to be bound by these Terms. If you do not agree to these Terms, you may not access or use the Service.'] },
  { title: "Visitor Access Requests", paragraphs: ["Visitors do not create PeAS accounts. Public access is limited to approved catalog metadata and reviewed abstracts. A visitor requesting a full paper must provide accurate contact information, verify the submitted email address, and accept that access remains subject to administrator review."], bullets: ["Do not submit a request using another person's identity or email.", "Do not forward, publish, or automate use of an approved access link.", "Approved links expire and may be revoked at any time."] },
  { title: "User Content and Intellectual Property Rights", paragraphs: ['Our Service may allow you to post, link, store, share, and otherwise make available certain information, text, graphics, videos, or other material ("User Content"). You retain all rights in, and are solely responsible for, the User Content you post to the Service.', "By making any User Content available through the Service, you grant to PeAS a non-exclusive, transferable, sublicensable, worldwide, royalty-free license to use, copy, modify, create derivative works based upon, distribute, publicly display, and publicly perform your User Content in connection with operating and providing the Service."] },
  { title: "Prohibited Activities and User Conduct", paragraphs: ["You agree not to engage in any of the following prohibited activities:"], bullets: ["Using the Service for any illegal purpose or in violation of any local, state, national, or international law.", "Violating or encouraging others to violate the rights of third parties, including intellectual property rights.", "Posting, uploading, or distributing any User Content that is unlawful, defamatory, libelous, inaccurate, or that a reasonable person could deem to be objectionable, profane, indecent, pornographic, harassing, threatening, embarrassing, hateful, or otherwise inappropriate.", "Interfering with security-related features of the Service.", "Transmitting any viruses, adware, spyware, worms, or other malicious code."] },
  { title: "Disclaimers and Limitation of Liability", paragraphs: ['The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, either express or implied, including, but not limited to, implied warranties of merchantability, fitness for a particular purpose, and non-infringement. PeAS makes no warranty that the Service will meet your requirements or be available on an uninterrupted, secure, or error-free basis.', "To the maximum extent permitted by applicable law, PeAS shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service."] },
];

const privacy: LegalSection[] = [
  { title: "PeAS Repository Updates Newsletter", paragraphs: ["With explicit consent, PeAS stores an email address and selected Department News, new-paper, and delivery-cadence preferences for PeAS Repository Updates (consent notice version repository-updates-v1). Email ownership is confirmed before activation. Delivery uses the institution-approved SMTP service; full papers are never attached and messages link only to public repository records and the normal access-request workflow.", "Immediate alerts follow a 10-minute publication safety check. Weekly digests are scheduled for Monday at 9:00 AM, Asia/Manila. PeAS records queued, sent, skipped, and failed delivery outcomes but does not use open pixels, click redirects, or engagement profiling.", "Confirmation and management links use signed, purpose-specific tokens. You may change preferences or withdraw consent at any time from an email link without signing in or paying a fee. Pending, unsubscribed, and suppressed addresses are deleted after 30 days; recipient-level delivery details are removed after 90 days, while non-personal campaign totals may remain. Older encrypted backup copies expire according to the institutional backup-rotation schedule."], bullets: ["The Office of Research & Publications contact address is used for replies and privacy questions.", "Changing an email address requires unsubscribing and registering the new address.", "Institutional retention, privacy, and sending-domain approval remain release requirements."] },
  { title: "What Information We Collect (and Why!)", paragraphs: ["PeAS collects only the information needed to operate the repository and review access requests."], subheading: "Information You Provide Directly:", bullets: ["Access request information: your name, verified email, affiliation, stated reason, optional explanation, consent timestamp, and the research requested.", "Communications: if you contact the Office of Research & Publications, PeAS retains the inquiry and its reference code.", "Administrator records: explicitly provisioned administrators have authentication and audit records; visitors do not have accounts."] },
  { title: "Information We Collect Automatically:", bullets: ['Log Data: Like most websites, our servers automatically record information ("log data") created by your use of the Services. This may include your IP address, browser type, operating system, the referring web page, pages visited, location, your mobile carrier, device information, search terms, and cookie information. We use this to keep things running smoothly and securely.', "Cookies & Similar Tech: We use cookies (tiny data files) to make your experience better – like remembering your login. You can control cookies through your browser settings. Some cookies are essential, others help us understand how you use PeAS.", "Aggregate analytics session cookie: PeAS uses a signed, HttpOnly cookie that lasts up to 30 minutes after the last tracked public page load to distinguish page views from whole-site visits. It contains no name, email address, IP address, or repository activity, and the session value is not stored in analytics rollups."], paragraphs: ["Data We DON'T Go Snooping For: Your secret cookie recipe, your cat's middle name, or your plans for world domination (unless it's in a document you explicitly upload for archiving, of course!). We only collect what's necessary to provide our awesome services."] },
  { title: "Contact Inquiry Retention", paragraphs: ["Contact inquiries, their status history, and administrator-only private notes are retained indefinitely. They have no public or administrative deletion endpoint, and stored inquiry content is accessible only to authenticated administrators."] },
  { title: "Research Access Request Retention", paragraphs: ["Unverified requests expire automatically. Verified requests, decisions, delivery status, and access-token audit data are retained for institutional review and security until the configured retention process removes or anonymizes them. Raw verification and access tokens are never stored; only cryptographic hashes are retained."], bullets: ["Verification links expire after 30 minutes.", "Approved access links expire after seven days by default and may be revoked or replaced.", "The system stores a salted hash of the submission address for abuse prevention rather than retaining the raw address in that field."] },
  { title: "How We Use Your Information", paragraphs: ["We use your information to:", "We're not in the business of selling your personal data to third-party marketers. That's just not our style."], bullets: ["Provide, maintain, and improve PeAS services.", "Personalize your experience (e.g., showing relevant research areas).", "Communicate with you about your account or services.", "Ensure security and prevent fraud.", "Analyze usage to understand how our services are used and make them better.", "Comply with legal obligations."] },
  { title: "Sharing & Disclosure (The Who, What, When)", paragraphs: ["We don't share your personal information lightly. Here are the limited circumstances when we might:"], bullets: ["With Your Consent: If you tell us it's okay.", "Service Providers: We work with trusted third-party companies to help us provide, analyze, and improve the Services (e.g., data hosting, maintenance services, database management). These providers only have access to your information to perform these tasks on our behalf and are obligated not to disclose or use it for other purposes.", "Legal Requirements: If required by law, such as to comply with a subpoena or other legal process. We'll aim to notify you unless legally prohibited.", "To Protect Rights: To protect the rights, property, or safety of PeAS, our users, or the public as required or permitted by law.", "Aggregated or De-Identified Data: We may share aggregated or de-identified information that cannot reasonably be used to identify you. For example, we might share statistics about the most common research keywords."] },
  { title: "Your Rights & Choices (You're in Control!)", paragraphs: ["You may contact the Office of Research & Publications to ask about personal information associated with a research access request."], bullets: ["Request access to or correction of the requester information you supplied.", "Request deletion where no institutional or legal retention requirement applies.", "Allow an unused verification link or approved link to expire, or ask the office to revoke it early.", "Manage non-essential cookies through your browser settings."] },
  { title: "Data Security (Our Digital Fortress)", paragraphs: ["We take the security of your data very seriously and implement a variety of security measures to maintain the safety of your personal information. This includes technical, administrative, and physical safeguards.", "However, please remember that no method of transmission over the Internet or method of electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your Personal Information, we cannot guarantee its absolute security."] },
  { title: "Children's Privacy (For the Young Scholars)", paragraphs: ["Our services are not directed to individuals under the age of 13 (or a higher age threshold depending on your local jurisdiction). We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will take steps to delete such information.", "If you are a parent or guardian and believe your child has provided us with information without your consent, please contact us."] },
  { title: "Changes to This Policy (We'll Keep You Posted)", paragraphs: ["We may update this Privacy Policy from time to time. If we make changes, we will notify you by revising the date at the top of the policy and, in some cases, we may provide you with additional notice (such as adding a statement to our homepage or sending you a notification).", "We encourage you to review the Privacy Policy whenever you access our services to stay informed about our information practices and the choices available to you."] },
];

export function PublicTermsPage() { return <LegalPage title="Terms & Conditions" intro="This document outlines the terms and conditions for using the PeAS (Paulinian electronic Archiving System). By using our services, you agree to these terms." sections={terms} kind="terms" />; }
export function PublicPrivacyPage() { return <LegalPage title="Our Commitment to Your Privacy" intro="At PeAS (Paulinian electronic Archiving System), we're not just about preserving documents; we're serious about protecting your personal information too. This policy explains how we collect, use, and safeguard your data with transparency and a touch of diligence." sections={privacy} kind="privacy" />; }

function LegalPage({ title, intro, sections, kind }: { title: string; intro: string; sections: LegalSection[]; kind: "terms" | "privacy" }) {
  const [activeSection, setActiveSection] = useState("legal-0");
  const isTerms = kind === "terms";

  useEffect(() => {
    const headings = sections.map((_, index) => document.getElementById(`legal-${index}`)).filter((section): section is HTMLElement => Boolean(section));
    if (!headings.length || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { rootMargin: "-112px 0px -62% 0px", threshold: [0, 1] });

    headings.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [sections]);

  const scrollToStart = () => document.getElementById("legal-0")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <PublicPageShell mainClassName={`peas-legal-page peas-legal-page--${kind}`}>
      <header className="peas-legal-hero">
        <div className="peas-legal-hero__inner">
          <div className="peas-legal-hero__copy">
            <span className="peas-legal-eyebrow">PeAS policy · {isTerms ? "Service agreement" : "Privacy notice"}</span>
            <h1>{title}</h1>
            <p>{intro}</p>
            <div className="peas-legal-hero__actions">
              <a className="peas-legal-action peas-legal-action--primary" href="#legal-0"><BookOpen aria-hidden="true" /> Start reading <ArrowRight aria-hidden="true" /></a>
              <Button className="peas-legal-action peas-legal-action--secondary" variant="outline" type="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print</Button>
            </div>
          </div>
          <aside className="peas-legal-summary" aria-label="Policy summary">
            <div className="peas-legal-summary__icon"><ShieldCheck aria-hidden="true" /></div>
            <span className="peas-legal-summary__eyebrow">At a glance</span>
            <strong>{isTerms ? "Use PeAS with confidence" : "Your information, clearly explained"}</strong>
            <ul>
              <li><CheckCircle2 aria-hidden="true" /><span>Applies to {isTerms ? "repository visitors and account holders" : "information handled by PeAS"}</span></li>
              <li><CheckCircle2 aria-hidden="true" /><span>{sections.length} sections to review</span></li>
              <li><Clock3 aria-hidden="true" /><span>Designed for a quick, focused read</span></li>
            </ul>
          </aside>
        </div>
      </header>

      <div className="peas-legal-layout">
        <nav className="peas-legal-nav" aria-label={`${title} sections`}>
          <div className="peas-legal-nav__heading"><span>Guide</span><strong>On this page</strong></div>
          <div className="peas-legal-nav__links">
            {sections.map((section, index) => {
              const id = `legal-${index}`;
              return <a className={activeSection === id ? "is-active" : undefined} aria-current={activeSection === id ? "location" : undefined} href={`#${id}`} key={section.title}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</a>;
            })}
          </div>
        </nav>

        <article className="peas-legal-content">
          {sections.map((section, index) => (
            <section className="peas-legal-section" id={`legal-${index}`} key={section.title}>
              <div className="peas-legal-section__heading">
                <span className="peas-legal-section__number">{String(index + 1).padStart(2, "0")}</span>
                <div><span>Section {index + 1}</span><h2>{section.title}</h2></div>
              </div>
              {section.subheading ? <h3>{section.subheading}</h3> : null}
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets ? <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            </section>
          ))}

          <aside className="peas-legal-contact">
            <div className="peas-legal-contact__icon"><BookOpen aria-hidden="true" /></div>
            <div><span>Need clarification?</span><h2>We can help you understand the policy.</h2><p>Contact the Office of Research &amp; Publications with questions about access, accounts, or repository use.</p></div>
            <a href="/contact.html">Contact the office <ArrowRight aria-hidden="true" /></a>
          </aside>
          <button className="peas-legal-back-to-top" type="button" onClick={scrollToStart}>Back to top <ArrowRight aria-hidden="true" /></button>
        </article>
      </div>
    </PublicPageShell>
  );
}
