import { useState, type FormEvent } from "react";
import { AuthShell } from "../../components/public/PublicPageShell";
import { Button } from "../../components/ui/button";
import { apiFetch, getErrorMessage } from "../../lib/api/http";

export function PublicResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return setNotice("This reset link is invalid or has expired.");
    if (password.length < 8) return setNotice("Use at least 8 characters.");
    if (password !== confirm) return setNotice("Passwords do not match.");
    setBusy(true); setNotice("");
    try { await apiFetch("/api/auth/reset-password", { method: "POST", json: { newPassword: password, token } }); setNotice("Password updated. Redirecting to login…"); setTimeout(() => window.location.assign("/log-in.html?reset=success"), 1200); }
    catch (error) { setNotice(getErrorMessage(error)); setBusy(false); }
  };
  return <AuthShell><section className="peas-reset-card"><img src="/Components/images/peas.png" alt="" /><h1>Choose a new password</h1><p>Enter and confirm the password you want to use for PeAS.</p>{notice ? <div role="status" aria-live="polite">{notice}</div> : null}<form onSubmit={submit}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} /><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} /><Button disabled={busy || !token} type="submit">{busy ? "Resetting…" : "Reset password"}</Button></form><a href="/log-in.html">Return to login</a></section></AuthShell>;
}
