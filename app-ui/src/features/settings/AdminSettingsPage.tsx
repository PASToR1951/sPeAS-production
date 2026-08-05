import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Camera, CheckCircle2, ClipboardList, Cloud, ExternalLink, FileArchive, Save, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import { Button } from "../../components/ui/button";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import { fetchMicrosoftSignInStatus, type MicrosoftSignInStatus } from "../../lib/api/authSettings";
import { uploadUserProfilePicture } from "../../lib/api/upload";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const administrationTools = [
  {
    label: "Operational Reports",
    href: "/admin/Components/reports.html",
    description: "Review repository inventory, archive activity, and category distribution.",
    icon: ClipboardList,
  },
  {
    label: "Experience Studio",
    href: "/admin/Components/experience-studio.html",
    description: "Manage the content and presentation of the public PeAS experience.",
    icon: FileArchive,
  },
  {
    label: "Role Management",
    href: "/admin/Components/role-management.html",
    description: "Assign administrator, content publisher, and registered-user access.",
    icon: ShieldCheck,
  },
] as const;

export function AdminSettingsPage() {
  const { userName, profile, updateProfile } = useAdminIdentity();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [savedUrl, setSavedUrl] = useState(profile?.profile_picture ? withLeadingSlash(profile.profile_picture) : "");
  const [saving, setSaving] = useState(false);
  const [microsoftStatus, setMicrosoftStatus] = useState<MicrosoftSignInStatus | null>(null);
  const [microsoftStatusError, setMicrosoftStatusError] = useState("");
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : savedUrl, [file, savedUrl]);

  useEffect(() => {
    fetchMicrosoftSignInStatus()
      .then(setMicrosoftStatus)
      .catch((error) => setMicrosoftStatusError(getErrorMessage(error)));
  }, []);

  function selectFile(nextFile?: File) {
    if (!nextFile) return setFile(null);
    if (!ACCEPTED_TYPES.has(nextFile.type)) return toast.error("Choose a valid JPEG, PNG, or WebP image.");
    if (nextFile.size > MAX_BYTES) return toast.error("Profile pictures must be 5 MB or smaller.");
    setFile(nextFile);
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      const result = await uploadUserProfilePicture(file);
      setSavedUrl(result.pictureUrl);
      updateProfile({ profile_picture: result.profilePicture });
      setFile(null);
      toast.success("Profile picture updated.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return <main className="peas-admin-page peas-settings-page">
    <PeasToaster />
    <AdminPageHeader eyebrow="Administration" title="Settings" description="Manage your administrator profile and workspace tools." />
    <section className="peas-admin-card peas-profile-settings-card">
      <div className="peas-profile-settings-card__avatar">{previewUrl ? <img src={previewUrl} alt={`${userName}'s profile`} /> : <span>{initials(userName)}</span>}</div>
      <div className="peas-profile-settings-card__content"><span>Profile picture</span><h2>{userName}</h2><p>Use a JPEG, PNG, or WebP image up to 5 MB.</p><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => selectFile(event.target.files?.[0])} /><div className="peas-profile-settings-card__actions"><Button variant="outline" onClick={() => inputRef.current?.click()}><Camera aria-hidden="true" /> Choose picture</Button><Button onClick={() => void save()} disabled={!file || saving}><Save aria-hidden="true" /> {saving ? "Saving…" : "Save changes"}</Button></div>{file ? <small>Selected: {file.name}</small> : null}</div>
    </section>
    <MicrosoftSignInSetup status={microsoftStatus} error={microsoftStatusError} />
    <section className="peas-admin-card peas-settings-tools" aria-labelledby="administration-tools-title">
      <div className="peas-settings-section-heading"><span>Workspace configuration</span><h2 id="administration-tools-title">Administration tools</h2><p>Open tools for repository oversight, public experience configuration, and access management.</p></div>
      <div className="peas-settings-tools__grid">
        {administrationTools.map((tool) => {
          const Icon = tool.icon;
          return <a className="peas-settings-tool-card" href={tool.href} key={tool.href}>
            <span className="peas-settings-tool-card__icon" aria-hidden="true"><Icon /></span>
            <span className="peas-settings-tool-card__copy"><strong>{tool.label}</strong><small>{tool.description}</small></span>
            <span className="peas-settings-tool-card__action">Open <ArrowRight aria-hidden="true" /></span>
          </a>;
        })}
      </div>
    </section>
  </main>;
}

function MicrosoftSignInSetup({ status, error }: { status: MicrosoftSignInStatus | null; error: string }) {
  const configuredCount = status
    ? [status.clientIdConfigured, status.clientSecretConfigured, status.tenantIdConfigured].filter(Boolean).length
    : 0;
  const statusLabel = status?.enabled ? "Enabled" : status ? "Needs setup" : "Checking…";

  return <section className="peas-admin-card peas-microsoft-setup" aria-labelledby="microsoft-sign-in-title">
    <header className="peas-microsoft-setup__header">
      <span className="peas-microsoft-setup__icon" aria-hidden="true"><Cloud /></span>
      <div>
        <span className="peas-settings-section-heading__eyebrow">Authentication</span>
        <h2 id="microsoft-sign-in-title">Enable Microsoft sign-in</h2>
        <p>Connect PeAS to the SPUD Microsoft Entra tenant without placing credentials in the interface.</p>
      </div>
      <span className={`peas-microsoft-status${status?.enabled ? " is-enabled" : ""}`}><span aria-hidden="true" />{statusLabel}</span>
    </header>

    {error ? <div className="peas-microsoft-setup__error" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div> : null}

    <div className="peas-microsoft-setup__content">
      <ol className="peas-microsoft-steps">
        <li><strong>Register PeAS in Microsoft Entra ID</strong><span>Create a Web app registration and allow the SPUD tenant to sign users in.</span></li>
        <li><strong>Add the redirect URI</strong><span>Register this exact callback URL in the app registration:</span><code>{status?.callbackUrl || "<PUBLIC_APP_URL>/api/auth/callback/microsoft"}</code></li>
        <li><strong>Set the server variables</strong><span>Add the three values to the deployment environment. The client secret must remain server-side.</span><div className="peas-microsoft-env-list"><code>MICROSOFT_CLIENT_ID</code><code>MICROSOFT_CLIENT_SECRET</code><code>MICROSOFT_TENANT_ID</code></div></li>
        <li><strong>Restart and test</strong><span>Restart PeAS, then open the login page and select Microsoft. Only <code>@{status?.allowedEmailDomain || "spud.edu.ph"}</code> accounts are accepted.</span></li>
      </ol>

      <aside className="peas-microsoft-setup__status" aria-label="Microsoft sign-in configuration status">
        <div className="peas-microsoft-setup__status-heading"><div><span className="peas-settings-section-heading__eyebrow">Server readiness</span><h3>{status ? `${configuredCount} of 3 values detected` : "Status unavailable"}</h3></div>{status?.enabled ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}</div>
        <dl>
          <StatusRow label="Client ID" configured={status?.clientIdConfigured ?? false} />
          <StatusRow label="Client secret" configured={status?.clientSecretConfigured ?? false} />
          <StatusRow label="Tenant ID" configured={status?.tenantIdConfigured ?? false} />
          <div><dt>Allowed domain</dt><dd><code>@{status?.allowedEmailDomain || "spud.edu.ph"}</code></dd></div>
        </dl>
        <a className="peas-microsoft-setup__link" href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">Open Microsoft Entra admin center <ExternalLink aria-hidden="true" /></a>
      </aside>
    </div>
  </section>;
}

function StatusRow({ label, configured }: { label: string; configured: boolean }) {
  return <div><dt>{label}</dt><dd className={configured ? "is-configured" : "is-missing"}>{configured ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}{configured ? "Configured" : "Not configured"}</dd></div>;
}

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A"; }
function withLeadingSlash(path: string) { return path.startsWith("/") ? path : `/${path}`; }
