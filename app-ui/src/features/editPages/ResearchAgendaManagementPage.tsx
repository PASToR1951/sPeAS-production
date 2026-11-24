import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import { createAdminResearchAgenda, fetchAdminResearchAgendas, reorderAdminResearchAgendas, updateAdminResearchAgenda } from "../../lib/api/upload";

type Agenda = Awaited<ReturnType<typeof fetchAdminResearchAgendas>>[number];
type AgendaStatus = "active" | "retired" | "all";

export function ResearchAgendaManagementPage() {
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [status, setStatus] = useState<AgendaStatus>("active");
  const [draftName, setDraftName] = useState("");
  const [editTarget, setEditTarget] = useState<Agenda | null>(null);
  const [editName, setEditName] = useState("");
  const [retireTarget, setRetireTarget] = useState<Agenda | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setAgendas(await fetchAdminResearchAgendas());
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function addAgenda(event: FormEvent) {
    event.preventDefault();
    if (busy || !draftName.trim()) return;
    setBusy(true);
    try {
      await createAdminResearchAgenda({ name: draftName });
      setDraftName("");
      toast.success("Research agenda added.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(agenda: Agenda) {
    setEditTarget(agenda);
    setEditName(agenda.name);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (busy || !editTarget || !editName.trim()) return;
    setBusy(true);
    try {
      await updateAdminResearchAgenda(editTarget.id, { name: editName });
      setEditTarget(null);
      toast.success("Research agenda updated.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAgenda(agenda: Agenda) {
    if (busy) return;
    setBusy(true);
    try {
      await updateAdminResearchAgenda(agenda.id, { isActive: !agenda.isActive });
      setRetireTarget(null);
      toast.success(agenda.isActive ? "Research agenda retired." : "Research agenda reactivated.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function moveAgenda(agenda: Agenda, direction: -1 | 1) {
    const index = agendas.findIndex((item) => item.id === agenda.id);
    const targetIndex = index + direction;
    if (busy || index < 0 || targetIndex < 0 || targetIndex >= agendas.length) return;
    const next = [...agendas];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setBusy(true);
    try {
      await reorderAdminResearchAgendas(next.map((item) => item.id));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const visibleAgendas = agendas.filter((agenda) => status === "all" || (status === "active" ? agenda.isActive : !agenda.isActive));

  return <main className="peas-admin-island peas-research-agenda-management">
    <PeasToaster />
    <AdminPageHeader title="Research Agenda" description="Manage the institutional priorities displayed on the public landing page." actions={<Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true" /> Refresh</Button>} />
    <section className="peas-classification-management__section">
      <header>
        <div><h2>Landing-page research agenda</h2><p>Retiring an item hides it from the public list.</p></div>
        <div className="peas-classification-tabs" role="group" aria-label="Research agenda status">
          {(["active", "retired", "all"] as const).map((item) => <Button key={item} size="sm" variant={status === item ? "default" : "outline"} aria-pressed={status === item} onClick={() => setStatus(item)}>{item === "active" ? "Active" : item === "retired" ? "Retired" : "All"}</Button>)}
        </div>
      </header>
      <form className="peas-classification-create-row" onSubmit={(event) => void addAgenda(event)}>
        <Input aria-label="New agenda name" placeholder="Research agenda name" maxLength={255} required value={draftName} onChange={(event) => setDraftName(event.currentTarget.value)} />
        <Button type="submit" disabled={busy || !draftName.trim()}><Plus aria-hidden="true" /> Add agenda</Button>
      </form>
      <div className="peas-classification-list">
        {visibleAgendas.length ? visibleAgendas.map((agenda) => {
          const index = agendas.findIndex((item) => item.id === agenda.id);
          return <div className="peas-classification-row peas-classification-agenda-row" key={agenda.id}>
            <span className="peas-classification-row__order">{String(index + 1).padStart(2, "0")}</span>
            <div className="peas-classification-agenda-row__details"><strong>{agenda.name}</strong></div>
            <span className="peas-classification-agenda-row__usage">Landing page</span>
            <Badge tone={agenda.isActive ? "green" : "slate"}>{agenda.isActive ? "Active" : "Retired"}</Badge>
            <div className="peas-classification-row__actions">
              <Button size="sm" variant="outline" aria-label={`Edit ${agenda.name}`} disabled={busy} onClick={() => openEdit(agenda)}><Pencil aria-hidden="true" /> Edit</Button>
              <Button size="sm" variant="outline" aria-label={`Move ${agenda.name} up`} disabled={busy || index === 0} onClick={() => void moveAgenda(agenda, -1)}><ArrowUp aria-hidden="true" /></Button>
              <Button size="sm" variant="outline" aria-label={`Move ${agenda.name} down`} disabled={busy || index === agendas.length - 1} onClick={() => void moveAgenda(agenda, 1)}><ArrowDown aria-hidden="true" /></Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => agenda.isActive ? setRetireTarget(agenda) : void toggleAgenda(agenda)}>{agenda.isActive ? "Retire" : "Reactivate"}</Button>
            </div>
          </div>;
        }) : <p>{busy ? "Loading research agendas…" : "No agendas match this filter."}</p>}
      </div>
    </section>
    <Dialog open={Boolean(editTarget)} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit research agenda</DialogTitle><DialogDescription>Update the text shown in the landing-page Research Agenda section.</DialogDescription></DialogHeader>
        <form className="peas-edit-form" onSubmit={(event) => void saveEdit(event)}>
          <label className="peas-field"><span>Agenda name</span><Input value={editName} maxLength={255} required onChange={(event) => setEditName(event.currentTarget.value)} /></label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button><Button type="submit" disabled={busy || !editName.trim()}>Save changes</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(retireTarget)} onOpenChange={(open) => { if (!open) setRetireTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Hide this research agenda item?</AlertDialogTitle><AlertDialogDescription>“{retireTarget?.name}” will no longer appear in the landing-page Research Agenda section. Historical data will be preserved.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); if (retireTarget) void toggleAgenda(retireTarget); }}>Retire agenda</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
