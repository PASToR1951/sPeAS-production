import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { AuthShell } from "../../components/public/PublicPageShell";
import { InteractiveImageDistortion } from "../../components/public/InteractiveImageDistortion";
import { Button } from "../../components/ui/button";
import { getErrorMessage } from "../../lib/api/http";
import { completePasswordSetup, logout, requestPasswordReset, safeSameOriginRedirect, signInUsername } from "../../lib/api/auth";

import { isStaffRole, STAFF_WORKSPACE } from "../../../../shared/staffRoles";

const FACADE_IMAGE_URL = "/Components/images/spud_facade.jpg";
const UNIVERSITY_LOGO_URL = "/Components/images/spud_logo_s.png";

export function PublicLoginPage() {
  const [mode, setMode] = useState<"login" | "forgot" | "setup">(() => new URLSearchParams(location.search).has("setup") ? "setup" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"password" | "forgot" | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const redirect = safeSameOriginRedirect(new URLSearchParams(window.location.search).get("redirect"), "");

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return setNotice({ kind: "error", text: "Enter your username and password." });
    setBusy("password"); setNotice(null);
    try {
      const session = await signInUsername(username, password);
      if (session.user.passwordSetupRequired) {
        setMode("setup");
        return;
      }
      if (isStaffRole(session.role)) {
        window.location.assign(STAFF_WORKSPACE);
        return;
      }
      if (session.role !== "admin") throw new Error("PeAS staff access is required.");
      const fallback = "/admin/dashboard.html";
      window.location.assign(redirect || fallback);
    } catch (error) { setNotice({ kind: "error", text: getErrorMessage(error) }); }
    finally { setBusy(null); }
  };

  const submitSetup = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) return setNotice({ kind: "error", text: "The new passwords must match." });
    setBusy("password"); setNotice(null);
    try {
      await completePasswordSetup(password, newPassword);
      await logout().catch(() => undefined);
      setPassword(""); setNewPassword(""); setConfirmPassword("");
      history.replaceState(null, "", location.pathname);
      setMode("login");
      setNotice({ kind: "success", text: "Password saved. Sign in with your new password." });
    } catch (error) { setNotice({ kind: "error", text: getErrorMessage(error) }); }
    finally { setBusy(null); }
  };

  const submitForgot = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return setNotice({ kind: "error", text: "Enter your registered email address." });
    setBusy("forgot"); setNotice(null);
    try { await requestPasswordReset(email); setNotice({ kind: "success", text: "If this administrator email is registered, a reset link has been sent." }); }
    catch (error) { setNotice({ kind: "error", text: getErrorMessage(error) }); }
    finally { setBusy(null); }
  };

  const noticeId = notice ? "peas-login-notice" : undefined;

  return <AuthShell showHomeLink={false}><section className="peas-login-page">
    <div className="peas-login-panel">
      <div className="peas-login-panel__content">
        <a className="peas-login-brand" href="/index.html" aria-label="Return to PeAS home">
          <span className="peas-login-brand__logos" aria-hidden="true">
            <img src="/Components/images/peas_logo.png" alt="" />
            <img src={UNIVERSITY_LOGO_URL} alt="" />
          </span>
          <span>{"Paulinian electronic\nArchiving System (PeAS)"}</span>
        </a>

        <div className="peas-login-heading">
          {mode === "forgot" ? <button className="peas-login-back" type="button" onClick={() => { setMode("login"); setNotice(null); }}><ArrowLeft aria-hidden="true" /> Back to sign in</button> : null}
          <h1>{mode === "forgot" ? "Forgot Password?" : mode === "setup" ? "Set your password" : "PeAS staff sign in"}</h1>
          <p>{mode === "forgot" ? "We will send reset instructions to your administrator email." : mode === "setup" ? "Choose a new password with at least 14 characters." : "For authorized PeAS staff and administrators."}</p>
        </div>

        {notice ? <div id={noticeId} className={`peas-login-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.kind === "error" ? <AlertCircle aria-hidden="true" /> : null}
          <span>{notice.text}</span>
        </div> : null}

        {mode === "login" ? <form className="peas-login-form" onSubmit={submitLogin} noValidate aria-describedby={noticeId}>
          <div className="peas-login-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoCapitalize="none"
              autoComplete="username"
              placeholder="Enter your username"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
          </div>
          <div className="peas-login-field">
            <label htmlFor="password">Password</label>
            <div className="peas-login-password">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
            <button className="peas-login-forgot" type="button" onClick={() => { setMode("forgot"); setNotice(null); }}>
              Forgot password?
            </button>
          </div>
          <Button className="peas-login-submit" disabled={busy !== null} size="lg" type="submit">
            {busy === "password" ? <LoaderCircle className="peas-spin" aria-hidden="true" /> : null}
            {busy === "password" ? "Signing in…" : "Sign in"}
          </Button>
        </form> : mode === "setup" ? <form className="peas-login-form" onSubmit={submitSetup} aria-describedby={noticeId}>
          <div className="peas-login-field">
            <label htmlFor="setup-current">Temporary password</label>
            <input id="setup-current" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.currentTarget.value)} />
          </div>
          <div className="peas-login-field">
            <label htmlFor="setup-new">New password</label>
            <input id="setup-new" type="password" autoComplete="new-password" required minLength={14} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.currentTarget.value)} />
          </div>
          <div className="peas-login-field">
            <label htmlFor="setup-confirm">Confirm new password</label>
            <input id="setup-confirm" type="password" autoComplete="new-password" required value={confirmPassword} onChange={event => setConfirmPassword(event.currentTarget.value)} />
          </div>
          <Button type="submit" disabled={busy !== null}>Save password</Button>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => {
            void logout().finally(() => window.location.replace("/log-in.html"));
          }}>Sign out</Button>
        </form> : <form className="peas-login-form" onSubmit={submitForgot} noValidate aria-describedby={noticeId}>
          <div className="peas-login-field">
            <label htmlFor="reset-email">Administrator email</label>
            <input
              id="reset-email"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="admin@example.com"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </div>
          <Button className="peas-login-submit" disabled={busy !== null} size="lg" type="submit">
            {busy === "forgot" ? <LoaderCircle className="peas-spin" aria-hidden="true" /> : null}
            {busy === "forgot" ? "Sending…" : "Send reset instructions"}
          </Button>
        </form>}

        <small className="peas-login-footer">PeAS. All Rights Reserved. L. Rovira Rd, Bantayan, Dumaguete, Negros Oriental.</small>
      </div>
    </div>
    <aside className="peas-login-art" aria-label="St. Paul University Dumaguete campus">
      <InteractiveImageDistortion src={FACADE_IMAGE_URL} />
      <div className="peas-login-art__scrim" />
      <img className="peas-login-art__seal" src={UNIVERSITY_LOGO_URL} alt="" />
      <div className="peas-login-art__caption">
        <div>
          <span>St. Paul University Dumaguete</span>
        </div>
      </div>
    </aside>
  </section></AuthShell>;
}
