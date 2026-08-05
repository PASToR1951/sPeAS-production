import { useCallback, useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import { PeasEmptyState, PeasErrorState, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Badge } from "../../components/ui/badge";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import {
  fetchManagedUsers,
  updateManagedUserRole,
  type ManagedRole,
  type ManagedUser,
} from "../../lib/api/roles";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

export function RoleManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    setError("");
    fetchManagedUsers()
      .then(setUsers)
      .catch((caughtError) => setError(getErrorMessage(caughtError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const changeRole = async (user: ManagedUser, nextRole: ManagedRole) => {
    if (nextRole === user.role) return;
    if (!window.confirm(`Change ${user.name || user.id} from ${roleLabel(user.role)} to ${roleLabel(nextRole)}? Their active sessions will be signed out.`)) {
      return;
    }

    setBusyUserId(user.id);
    try {
      const updated = await updateManagedUserRole(user.id, nextRole);
      setUsers((current) => current.map((entry) => entry.id === user.id ? updated : entry));
      toast.success(`${updated.name || updated.id} is now ${roleLabel(updated.role)}.`);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <main className="peas-admin-island peas-role-management">
      <PeasToaster />
      <AdminPageHeader eyebrow="Security & access" title="Role Management" description="Assign administrator, content publisher, or registered-user access. Role changes revoke the user’s active sessions." />

      {loading ? <PeasLoadingState /> : error ? (
        <PeasErrorState title="Unable to load users" message={error} onRetry={loadUsers} />
      ) : users.length === 0 ? (
        <PeasEmptyState title="No users found" description="Provisioned PeAS accounts will appear here." />
      ) : (
        <section className="peas-role-table-card" aria-label="PeAS user roles">
          <div className="peas-role-table-card__summary">
            <UsersRound aria-hidden="true" />
            <span>{users.length} managed {users.length === 1 ? "account" : "accounts"}</span>
          </div>
          <div className="peas-role-table-wrap">
            <table className="peas-role-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>School ID</th>
                  <th>Current access</th>
                  <th>Assign role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><strong>{user.name || user.id}</strong><small>{user.email}</small></td>
                    <td>{user.display_username || user.username || user.id}</td>
                    <td><Badge tone={user.role === "admin" ? "green" : user.role === "publisher" ? "gold" : "blue"}>{roleLabel(user.role)}</Badge></td>
                    <td>
                      <select
                        aria-label={`Role for ${user.name || user.id}`}
                        disabled={busyUserId === user.id}
                        value={user.role}
                        onChange={(event) => void changeRole(user, event.currentTarget.value as ManagedRole)}
                      >
                        <option value="user">Registered User</option>
                        <option value="publisher">Content Publisher</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function roleLabel(role: ManagedRole) {
  if (role === "admin") return "Administrator";
  if (role === "publisher") return "Content Publisher";
  return "Registered User";
}
