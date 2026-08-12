import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { Button } from "../../components/ui/button";
import { confirmNewsletter, manageNewsletter, saveNewsletterPreferences, unsubscribeNewsletter, type NewsletterPreferences } from "../../lib/api/newsletter";
import { getErrorMessage } from "../../lib/api/http";

type View = { kind: "loading" } | { kind: "message"; title: string; message: string } | { kind: "manage"; token: string; email: string; status: string; preferences: NewsletterPreferences; schedule: string };
export function PublicNewsletterPage() {
  const [view, setView] = useState<View>({ kind: "loading" });
  useEffect(() => {
    const raw = window.location.hash.slice(1), index = raw.indexOf("=");
    const purpose = raw.slice(0, index), token = index >= 0 ? raw.slice(index + 1) : "";
    window.history.replaceState({}, "", window.location.pathname);
    if (!token) { setView({ kind: "message", title: "PeAS Repository Updates", message: "Use the secure link in a PeAS email to confirm, manage, or unsubscribe." }); return; }
    const request = purpose === "confirm" ? confirmNewsletter(token).then(() => ({ kind: "message" as const, title: "Subscription confirmed", message: "Your preferences are active. Future qualifying updates will follow your selected schedule." }))
      : purpose === "unsubscribe" ? unsubscribeNewsletter(token).then(() => ({ kind: "message" as const, title: "Unsubscribed", message: "You will not receive future repository updates. This action is safe to repeat." }))
      : purpose === "manage" ? manageNewsletter(token).then((result) => result.status === "suppressed"
        ? ({ kind: "message" as const, title: "Subscription unavailable", message: "This address cannot be reactivated from an old email. Contact the Office of Research & Publications for guidance." })
        : result.status === "unsubscribed" ? ({ kind: "message" as const, title: "Already unsubscribed", message: "This address is already unsubscribed. Register again with a fresh confirmation if you want future updates." })
        : ({ kind: "manage" as const, token, email: result.email, status: result.status, preferences: result.preferences, schedule: result.weeklySchedule }))
      : Promise.reject(new Error("Invalid newsletter link."));
    void request.then(setView).catch((error) => setView({ kind: "message", title: "Link unavailable", message: getErrorMessage(error) }));
  }, []);
  return <PublicPageShell mainClassName="peas-newsletter-page"><section className="peas-newsletter-management"><MailCheck aria-hidden="true" />{view.kind === "loading" ? <><h1>Checking your secure link…</h1><p role="status">Please wait.</p></> : view.kind === "message" ? <><h1>{view.title}</h1><p role="status">{view.message}</p><a href="/news.html">Return to PeAS News</a></> : <PreferenceManager initial={view} />}</section></PublicPageShell>;
}

function PreferenceManager({ initial }: { initial: Extract<View, { kind: "manage" }> }) {
  const [preferences, setPreferences] = useState(initial.preferences), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const save = async () => { if (!preferences.news && !preferences.papers) { setMessage("Choose at least one content type, or unsubscribe."); return; } try { setBusy(true); await saveNewsletterPreferences(initial.token, preferences); setMessage("Preferences updated. Changes apply before the next queued message is sent."); } catch (error) { setMessage(getErrorMessage(error)); } finally { setBusy(false); } };
  const unsubscribe = async () => { try { setBusy(true); await unsubscribeNewsletter(initial.token); setMessage("You are unsubscribed and will receive no future updates."); } catch { setMessage("You are unsubscribed."); } finally { setBusy(false); } };
  return <><h1>Manage repository updates</h1><p>Subscription: <strong>{initial.email}</strong></p><p>{initial.schedule}</p><div className="peas-newsletter-preferences"><fieldset><legend>Content</legend><label><input type="checkbox" checked={preferences.news} onChange={(event) => setPreferences({ ...preferences, news: event.target.checked })} /> Department News</label><label><input type="checkbox" checked={preferences.papers} onChange={(event) => setPreferences({ ...preferences, papers: event.target.checked })} /> New papers</label></fieldset><fieldset><legend>Schedule</legend><label><input type="radio" name="manage-cadence" checked={preferences.cadence === "weekly"} onChange={() => setPreferences({ ...preferences, cadence: "weekly" })} /> Weekly digest</label><label><input type="radio" name="manage-cadence" checked={preferences.cadence === "immediate"} onChange={() => setPreferences({ ...preferences, cadence: "immediate" })} /> Immediate alerts</label></fieldset><div><Button disabled={busy} onClick={() => void save()}>Save preferences</Button><Button disabled={busy} variant="outline" onClick={() => void unsubscribe()}>Unsubscribe</Button></div>{message ? <p role="status">{message}</p> : null}</div></>;
}
