import { useEffect, useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { getErrorMessage } from "../../lib/api/http";
import { getNewsletterSettings, subscribeNewsletter, type NewsletterPreferences } from "../../lib/api/newsletter";

export function NewsletterSignup({ variant = "full" }: { variant?: "full" | "compact" }) {
  const [open, setOpen] = useState(false), [email, setEmail] = useState("");
  if (variant === "compact") return <div className="peas-newsletter-compact"><h2>Repository updates</h2><p>Get new department news and public papers by email.</p><div><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" aria-label="Newsletter email address" /><Button onClick={() => setOpen(true)} disabled={!email.trim()}>Subscribe</Button></div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="peas-newsletter-dialog"><DialogTitle>PeAS Repository Updates</DialogTitle><DialogDescription>Choose what you receive and confirm your consent.</DialogDescription><NewsletterForm initialEmail={email} onComplete={() => setOpen(false)} /></DialogContent></Dialog></div>;
  return <section className="peas-newsletter-callout" aria-labelledby="newsletter-signup-title"><div><Mail aria-hidden="true" /><span>PeAS Repository Updates</span><h2 id="newsletter-signup-title">New research, delivered thoughtfully</h2><p>Receive newly published department news and public repository records. Full papers are never attached.</p></div><NewsletterForm /></section>;
}

function NewsletterForm({ initialEmail = "", onComplete }: { initialEmail?: string; onComplete?: () => void }) {
  const [email, setEmail] = useState(initialEmail), [preferences, setPreferences] = useState<NewsletterPreferences>({ cadence: "weekly", news: true, papers: true });
  const [consent, setConsent] = useState(false), [website, setWebsite] = useState(""), [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"ready" | "submitting" | "sent">("ready"), [error, setError] = useState("");
  useEffect(() => { void getNewsletterSettings().then((value) => setAvailable(value.signupEnabled)).catch(() => setAvailable(false)); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!preferences.news && !preferences.papers) { setError("Choose news, papers, or both."); return; }
    if (!consent) { setError("Consent is required before we can send updates."); return; }
    try { setStatus("submitting"); await subscribeNewsletter(email, preferences, consent, website); setStatus("sent"); }
    catch (caught) { setError(getErrorMessage(caught)); setStatus("ready"); }
  };
  if (available === false) return <div className="peas-newsletter-status" role="status">Newsletter signup is temporarily unavailable.</div>;
  if (status === "sent") return <div className="peas-newsletter-status" role="status"><strong>Check your inbox.</strong><p>If the address can be subscribed, a confirmation email will arrive shortly. The link expires in 24 hours.</p>{onComplete ? <Button variant="outline" onClick={onComplete}>Close</Button> : null}</div>;
  return <form className="peas-newsletter-form" onSubmit={submit} noValidate>
    <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <fieldset><legend>Send me</legend><label><input type="checkbox" checked={preferences.news} onChange={(event) => setPreferences({ ...preferences, news: event.target.checked })} /> Department News</label><label><input type="checkbox" checked={preferences.papers} onChange={(event) => setPreferences({ ...preferences, papers: event.target.checked })} /> New papers</label></fieldset>
    <fieldset><legend>Delivery schedule</legend><label><input type="radio" name="cadence" checked={preferences.cadence === "weekly"} onChange={() => setPreferences({ ...preferences, cadence: "weekly" })} /> Weekly digest — Mondays at 9:00 AM, Asia/Manila</label><label><input type="radio" name="cadence" checked={preferences.cadence === "immediate"} onChange={() => setPreferences({ ...preferences, cadence: "immediate" })} /> Immediate alerts — after a 10-minute publication check</label></fieldset>
    <label className="peas-newsletter-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I consent to PeAS using this address only for my selected repository updates. I may withdraw consent at any time. <a href="/pages/miscellaneous/Privacy.html">Privacy and retention notice</a>.</label>
    <label className="peas-newsletter-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    {error ? <p className="peas-newsletter-error" role="alert">{error}</p> : null}
    <Button type="submit" disabled={status === "submitting" || available === null}>{status === "submitting" ? "Requesting confirmation…" : "Request confirmation"}</Button>
    <small>Messages contain public record links only—no PDFs, tracking pixels, or click tracking.</small>
  </form>;
}
