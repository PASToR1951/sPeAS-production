import { useMemo, useRef, useState } from "react";
import { Camera, Save } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import { Button } from "../../components/ui/button";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import { uploadUserProfilePicture } from "../../lib/api/upload";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function AdminSettingsPage() {
  const { userName, profile, updateProfile } = useAdminIdentity();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [savedUrl, setSavedUrl] = useState(profile?.profile_picture ? withLeadingSlash(profile.profile_picture) : "");
  const [saving, setSaving] = useState(false);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : savedUrl, [file, savedUrl]);

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
    <AdminPageHeader eyebrow="Settings" title="Profile" description="Manage your administrator profile picture." />
    <section className="peas-admin-card peas-profile-settings-card">
      <div className="peas-profile-settings-card__avatar">{previewUrl ? <img src={previewUrl} alt={`${userName}'s profile`} /> : <span>{initials(userName)}</span>}</div>
      <div className="peas-profile-settings-card__content"><span>Profile picture</span><h2>{userName}</h2><p>Use a JPEG, PNG, or WebP image up to 5 MB.</p><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => selectFile(event.target.files?.[0])} /><div className="peas-profile-settings-card__actions"><Button variant="outline" onClick={() => inputRef.current?.click()}><Camera aria-hidden="true" /> Choose picture</Button><Button onClick={() => void save()} disabled={!file || saving}><Save aria-hidden="true" /> {saving ? "Saving…" : "Save changes"}</Button></div>{file ? <small>Selected: {file.name}</small> : null}</div>
    </section>
  </main>;
}

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A"; }
function withLeadingSlash(path: string) { return path.startsWith("/") ? path : `/${path}`; }
