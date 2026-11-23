import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck, Trash2, UserPlus, UserRoundX } from "lucide-react";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "../../../../shared/staffRoles";
import { PeasEmptyState, PeasErrorState, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import { createStaffAccount, deleteManagedAdministrator, fetchManagedUsers, reissueStaffPassword, revokeManagedUserSessions, type ManagedUser, type TemporaryCredential } from "../../lib/api/roles";
import { requestPasswordReset } from "../../lib/api/auth";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

const roleDescriptions: Record<StaffRole, string> = {
  repository_assistant: "Prepares and submits their own papers and issues for review.",
  manuscript_reviewer: "Reviews and publishes assigned papers and issues.",
  news_editor: "Creates their own department news drafts and manages draft media.",
};

export function RoleManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<StaffRole>("repository_assistant");
  const [credential, setCredential] = useState<TemporaryCredential | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    setError("");
    fetchManagedUsers().then(setUsers).catch(error => setError(getErrorMessage(error))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      setCredential(await createStaffAccount({
        name: String(form.get("name")),
        username: String(form.get("username")),
        email: String(form.get("email")),
        role,
      }));
      setCreating(false);
      loadUsers();
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setSaving(false); }
  };

  async function act(user: ManagedUser, action: "revoke" | "reset" | "delete" | "reissue") {
    if (action === "delete" && !window.confirm(`Permanently remove administrator ${user.name || user.id}?`)) return;
    if (action === "reissue" && !window.confirm(`Replace ${user.name}'s password and end their current sessions?`)) return;
    setBusyUserId(user.id);
    try {
      if (action === "revoke") {
        await revokeManagedUserSessions(user.id);
        toast.success("Account sessions revoked.");
      }
      if (action === "reset") {
        await requestPasswordReset(user.email);
        toast.success(`Password reset requested for ${user.email}. Check the inbox and spam folder.`);
      }
      if (action === "delete") {
        await deleteManagedAdministrator(user.id);
        toast.success("Administrator removed.");
        loadUsers();
      }
      if (action === "reissue") {
        setCredential(await reissueStaffPassword(user.id));
        loadUsers();
      }
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setBusyUserId(null); }
  }

  const adminCount = users.filter(user => user.role === "admin").length;
  return <main className="peas-admin-island peas-role-management">
    <PeasToaster />
    <AdminPageHeader title="Role Management" description="Create staff accounts and manage account security. Administrator accounts are provisioned from the server console."
      actions={<Button onClick={() => { setRole("repository_assistant"); setCreating(true); }}><UserPlus aria-hidden="true" /> Create Account</Button>} />
    {loading ? <PeasLoadingState /> : error ? <PeasErrorState title="Unable to load accounts" message={error} onRetry={loadUsers} /> : !users.length ? <PeasEmptyState title="No accounts found" /> :
      <section className="peas-role-table-card" aria-label="PeAS accounts"><div className="peas-role-table-wrap">
        <table className="peas-role-table">
          <thead><tr><th>Account</th><th>Username</th><th>Role and status</th><th>Security actions</th></tr></thead>
          <tbody>{users.map(user => <tr key={user.id}>
            <td><strong>{user.name || user.id}</strong><small>{user.email}</small></td>
            <td>{user.display_username || user.username || user.id}</td>
            <td><Badge tone="green"><ShieldCheck aria-hidden="true" /> {ROLE_LABELS[user.role]}</Badge>
              <small>{user.password_setup_required ? "Password setup pending" : "Active"}</small></td>
            <td><div className="peas-row-actions">
              <Button size="sm" variant="outline" disabled={busyUserId !== null} onClick={() => void act(user, "revoke")}><UserRoundX aria-hidden="true" /> Revoke sessions</Button>
              <Button size="sm" variant="outline" disabled={busyUserId !== null} onClick={() => void act(user, user.role === "admin" ? "reset" : "reissue")}>
                <KeyRound aria-hidden="true" /> {user.role === "admin" ? "Reset password" : "Reissue password"}
              </Button>
              {user.role === "admin" ? <Button size="sm" variant="destructive" disabled={busyUserId !== null || adminCount <= 1} onClick={() => void act(user, "delete")}><Trash2 aria-hidden="true" /> Remove</Button> : null}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div></section>}
    <Dialog open={creating} onOpenChange={open => { if (!saving) setCreating(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create staff account</DialogTitle><DialogDescription>Choose the role that matches the person’s work.</DialogDescription></DialogHeader>
        <form className="peas-staff-form" onSubmit={create}>
          <label>Full name<Input name="name" autoComplete="off" required maxLength={100} /></label>
          <label>Username<Input name="username" autoComplete="off" required minLength={2} maxLength={30} pattern="[a-zA-Z0-9._\\-]+" /></label>
          <label>Email<Input name="email" type="email" autoComplete="off" required maxLength={255} /></label>
          <label>Role<select value={role} onChange={event => setRole(event.currentTarget.value as StaffRole)}>
            {STAFF_ROLES.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
          </select></label>
          <p aria-live="polite">{roleDescriptions[role]}</p>
          <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create account"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={!!credential} onOpenChange={open => { if (!open) setCredential(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Temporary sign-in details</DialogTitle>
          <DialogDescription>Share these details privately. The password is visible here once. The staff member must replace it at first sign-in.</DialogDescription></DialogHeader>
        {credential ? <div className="peas-staff-form">
          <label>Username<Input readOnly value={credential.username} /></label>
          <label>Temporary password<Input readOnly value={credential.temporaryPassword} onFocus={event => event.currentTarget.select()} /></label>
          <DialogFooter><Button onClick={() => setCredential(null)}>Done</Button></DialogFooter>
        </div> : null}
      </DialogContent>
    </Dialog>
  </main>;
}
