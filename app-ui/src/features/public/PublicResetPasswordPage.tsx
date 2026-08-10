import { useState, type FormEvent } from "react";
import { AuthShell } from "../../components/public/PublicPageShell";
import { Button } from "../../components/ui/button";
import { apiFetch, getErrorMessage } from "../../lib/api/http";

type ResetNotice = { kind: "error" | "success"; text: string };

export function PublicResetPasswordPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");
  const invalidLink = !token || searchParams.get("error") === "INVALID_TOKEN";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ResetNotice | null>(
    invalidLink
      ? { kind: "error", text: "This reset link is invalid or has expired. Request a new link from the sign-in page." }
      : null,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    if (password.length < 14) {
      return setNotice({ kind: "error", text: "Use at least 14 characters." });
    }
    if (password !== confirm) {
      return setNotice({ kind: "error", text: "Passwords do not match." });
    }
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        json: { newPassword: password, token },
      });
      setNotice({ kind: "success", text: "Password updated. Redirecting to sign in…" });
      setTimeout(() => window.location.assign("/log-in.html?reset=success"), 1200);
    } catch (error) {
      setNotice({ kind: "error", text: getErrorMessage(error) });
      setBusy(false);
    }
  };

  const noticeId = notice ? "peas-reset-notice" : undefined;

  return <AuthShell><section className="peas-reset-card" aria-labelledby="reset-password-title">
    <img src="/Components/images/peas.png" alt="" />
    <h1 id="reset-password-title">Reset administrator password</h1>
    <p>Enter and confirm a new password with at least 14 characters.</p>
    {notice ? <div id={noticeId} className={`peas-reset-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</div> : null}
    <form onSubmit={submit} aria-describedby={noticeId}>
      <label htmlFor="new-password">New password</label>
      <input id="new-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required disabled={busy || invalidLink} value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
      <label htmlFor="confirm-password">Confirm password</label>
      <input id="confirm-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required disabled={busy || invalidLink} value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} />
      <Button disabled={busy || invalidLink} type="submit">{busy ? "Resetting…" : "Reset password"}</Button>
    </form>
    <a href="/log-in.html">Return to sign in</a>
  </section></AuthShell>;
}
