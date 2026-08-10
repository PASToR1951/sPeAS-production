import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Trash2, UserRoundX } from "lucide-react";
import { PeasEmptyState, PeasErrorState, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import { deleteManagedAdministrator, fetchManagedUsers, revokeManagedUserSessions, type ManagedUser } from "../../lib/api/roles";
import { requestPasswordReset } from "../../lib/api/auth";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

export function RoleManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true); setError("");
    fetchManagedUsers().then(setUsers).catch((error) => setError(getErrorMessage(error))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function act(user: ManagedUser, action: "revoke" | "reset" | "delete") {
    if (action === "delete" && !window.confirm(`Permanently remove administrator ${user.name || user.id}?`)) return;
    setBusyUserId(user.id);
    try {
      if (action === "revoke") await revokeManagedUserSessions(user.id);
      if (action === "reset") await requestPasswordReset(user.email);
      if (action === "delete") await deleteManagedAdministrator(user.id);
      toast.success(action === "revoke" ? "Administrator sessions revoked." : action === "reset" ? `Password reset requested for ${user.email}. Check the inbox and spam folder.` : "Administrator removed.");
      if (action === "delete") loadUsers();
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setBusyUserId(null); }
  }

  return <main className="peas-admin-island peas-role-management"><PeasToaster />
    <AdminPageHeader eyebrow="Security & access" title="Administrator Accounts" description="PeAS permits explicitly provisioned administrator accounts only. New administrators are created through the deployment bootstrap command." />
    {loading ? <PeasLoadingState /> : error ? <PeasErrorState title="Unable to load administrators" message={error} onRetry={loadUsers} /> : !users.length ? <PeasEmptyState title="No administrators found" description="Provision an administrator from the server console." /> :
      <section className="peas-role-table-card" aria-label="PeAS administrators"><div className="peas-role-table-wrap"><table className="peas-role-table"><thead><tr><th>Administrator</th><th>Identifier</th><th>Access</th><th>Security actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name || user.id}</strong><small>{user.email}</small></td><td>{user.display_username || user.username || user.id}</td><td><Badge tone="green"><ShieldCheck aria-hidden="true" /> Administrator</Badge></td><td><div className="peas-row-actions"><Button size="sm" variant="outline" disabled={busyUserId === user.id} onClick={() => void act(user, "revoke")}><UserRoundX aria-hidden="true" /> Revoke sessions</Button><Button size="sm" variant="outline" disabled={busyUserId === user.id} onClick={() => void act(user, "reset")}><KeyRound aria-hidden="true" /> Reset password</Button><Button size="sm" variant="destructive" disabled={busyUserId === user.id || users.length <= 1} onClick={() => void act(user, "delete")}><Trash2 aria-hidden="true" /> Remove</Button></div></td></tr>)}</tbody></table></div></section>}
  </main>;
}
