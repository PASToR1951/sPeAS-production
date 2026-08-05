import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { AuthShell } from "../../components/public/PublicPageShell";
import { InteractiveImageDistortion } from "../../components/public/InteractiveImageDistortion";
import { Button } from "../../components/ui/button";
import { getErrorMessage } from "../../lib/api/http";
import { requestPasswordReset, safeSameOriginRedirect, signInMicrosoft, signInUsername } from "../../lib/api/auth";
import { experienceBlockProps, usePublicExperience } from "../../lib/api/experience";

const FACADE_IMAGE_URL = "/Components/images/spud_facade.jpg";
const LEGACY_LOGIN_IMAGES = new Set([
  "/Components/images/1.jpg",
  "/Components/images/office-20of-20research-20-26-20publications.png",
]);
const LEGACY_PASSWORD_PLACEHOLDERS = new Set(["••••••••", "********"]);

export function PublicLoginPage() {
  const { config, canvasMode } = usePublicExperience("login");
  const content = experienceBlockProps(config, "login", "LoginShellBlock");
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [schoolId, setSchoolId] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"password" | "microsoft" | "forgot" | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const redirect = safeSameOriginRedirect(new URLSearchParams(window.location.search).get("redirect"), "");

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (canvasMode) return;
    if (!schoolId.trim() || !password) return setNotice({ kind: "error", text: "Enter both your School ID and password." });
    setBusy("password"); setNotice(null);
    try {
      const session = await signInUsername(schoolId, password);
      const fallback = session.role === "admin"
        ? "/admin/dashboard.html"
        : session.role === "publisher"
          ? "/admin/Components/news.html"
          : "/index.html";
      window.location.assign(redirect || fallback);
    } catch (error) { setNotice({ kind: "error", text: getErrorMessage(error) }); }
    finally { setBusy(null); }
  };

  const submitForgot = async (event: FormEvent) => {
    event.preventDefault();
    if (canvasMode) return;
    if (!email.trim()) return setNotice({ kind: "error", text: "Enter your registered email address." });
    setBusy("forgot"); setNotice(null);
    try { await requestPasswordReset(email); setNotice({ kind: "success", text: "If the address is registered, a reset link has been sent." }); }
    catch (error) { setNotice({ kind: "error", text: getErrorMessage(error) }); }
    finally { setBusy(null); }
  };

  const configuredImageUrl = String(content.backgroundImageUrl || "");
  const backgroundImageUrl = !configuredImageUrl || LEGACY_LOGIN_IMAGES.has(configuredImageUrl)
    ? FACADE_IMAGE_URL
    : configuredImageUrl;
  const configuredPasswordPlaceholder = String(content.passwordPlaceholder || "");
  const passwordPlaceholder = !configuredPasswordPlaceholder || LEGACY_PASSWORD_PLACEHOLDERS.has(configuredPasswordPlaceholder)
    ? "Enter your password"
    : configuredPasswordPlaceholder;
  const universityLogoUrl = String(content.graphicLogoUrl || "/Components/images/spud_logo_s.png");
  const noticeId = notice ? "peas-login-notice" : undefined;

  return <AuthShell showHomeLink={false}><section className="peas-login-page">
    <div className="peas-login-panel">
      <div className="peas-login-panel__content">
        <a className="peas-login-brand" href="/index.html" aria-label="Return to PeAS home">
          <span className="peas-login-brand__logos" aria-hidden="true">
            <img src={String(content.logoUrl || "/Components/images/peas_logo.png")} alt="" />
            <img src={universityLogoUrl} alt="" />
          </span>
          <span>{String(content.brandText || "Paulinian electronic\nArchiving System (PeAS)")}</span>
        </a>

        <div className="peas-login-heading">
          {mode === "forgot" ? <button className="peas-login-back" type="button" onClick={() => { setMode("login"); setNotice(null); }}><ArrowLeft aria-hidden="true" /> Back to sign in</button> : null}
          <h1>{String(mode === "forgot" ? content.forgotPasswordTitle || "Forgot Password?" : content.title || "Welcome back")}</h1>
          <p>{String(mode === "forgot" ? content.forgotPasswordSubtitle || "We will send reset instructions to your registered email." : content.subtitle || "Sign in to access PeAS.")}</p>
        </div>

        {notice ? <div id={noticeId} className={`peas-login-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.kind === "error" ? <AlertCircle aria-hidden="true" /> : null}
          <span>{notice.text}</span>
        </div> : null}

        {mode === "login" ? <form className="peas-login-form" onSubmit={submitLogin} noValidate aria-describedby={noticeId}>
          <div className="peas-login-field">
            <label htmlFor="school-id">{String(content.schoolIdLabel || "School ID")}</label>
            <input
              id="school-id"
              autoCapitalize="none"
              autoComplete="username"
              placeholder={String(content.schoolIdPlaceholder || "Enter your School ID")}
              spellCheck={false}
              value={schoolId}
              onChange={(event) => setSchoolId(event.currentTarget.value)}
            />
          </div>
          <div className="peas-login-field">
            <label htmlFor="password">{String(content.passwordLabel || "Password")}</label>
            <div className="peas-login-password">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder={passwordPlaceholder}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
            <button className="peas-login-forgot" type="button" onClick={() => { setMode("forgot"); setNotice(null); }}>
              {String(content.forgotPasswordLabel || "Forgot password?")}
            </button>
          </div>
          <Button className="peas-login-submit" disabled={busy !== null || canvasMode} size="lg" type="submit">
            {busy === "password" ? <LoaderCircle className="peas-spin" aria-hidden="true" /> : null}
            {busy === "password" ? "Signing in…" : String(content.submitLabel || "Sign in")}
          </Button>
          <div className="peas-login-divider"><span>or continue with</span></div>
          <Button
            className="peas-login-microsoft"
            disabled={busy !== null || canvasMode}
            size="lg"
            variant="outline"
            type="button"
            onClick={async () => {
              setBusy("microsoft");
              setNotice(null);
              try { await signInMicrosoft(redirect || "/auth/landing.html"); }
              catch (error) { setNotice({ kind: "error", text: getErrorMessage(error) }); setBusy(null); }
            }}
          >
            {busy === "microsoft" ? <LoaderCircle className="peas-spin" aria-hidden="true" /> : <span className="peas-microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>}
            {busy === "microsoft" ? "Connecting…" : "Microsoft"}
          </Button>
        </form> : <form className="peas-login-form" onSubmit={submitForgot} noValidate aria-describedby={noticeId}>
          <div className="peas-login-field">
            <label htmlFor="reset-email">Registered email</label>
            <input
              id="reset-email"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="name@su.edu.ph"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </div>
          <Button className="peas-login-submit" disabled={busy !== null || canvasMode} size="lg" type="submit">
            {busy === "forgot" ? <LoaderCircle className="peas-spin" aria-hidden="true" /> : null}
            {busy === "forgot" ? "Sending…" : "Send reset instructions"}
          </Button>
        </form>}

        <small className="peas-login-footer">{String(content.footerText || "PeAS. All Rights Reserved.")}</small>
      </div>
    </div>
    <aside className="peas-login-art" aria-label="St. Paul University Dumaguete campus">
      <InteractiveImageDistortion src={backgroundImageUrl} />
      <div className="peas-login-art__scrim" />
      <img className="peas-login-art__seal" src={universityLogoUrl} alt="" />
      <div className="peas-login-art__caption">
        <div>
          <span>St. Paul University Dumaguete</span>
        </div>
      </div>
    </aside>
  </section></AuthShell>;
}
