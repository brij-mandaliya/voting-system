import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, download, upload, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  CheckRow,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorBox,
  fieldClass,
  LabelledInput,
  LabelledSelect,
  PageTitle,
  SectionHeading,
  Skeleton,
  StatCard,
  StatStrip,
} from "../../components/ui";
import { useToast } from "../../contexts/Toast";
import {
  IconCopy,
  IconDownload,
  IconFile,
  IconSearch,
  IconUsers,
} from "../../components/icons";

interface Row {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  status: string;
  team?: { id: string; name: string } | null;
}

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-brand-50 text-brand-700 ring-brand-200",
  MODERATOR: "bg-ocean-50 text-ocean-700 ring-ocean-200",
  PARTICIPANT: "bg-ink-100 text-ink-600 ring-ink-200",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function Participants() {
  const qc = useQueryClient();
  const toast = useToast();
  const listQ = useQuery({ queryKey: ["participants"], queryFn: () => api<{ participants: Row[] }>("/participants") });
  const teamsQ = useQuery({ queryKey: ["teams"], queryFn: () => api<{ teams: any[] }>("/teams") });

  const [form, setForm] = useState({ name: "", username: "", email: "", role: "PARTICIPANT", teamId: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; username: string; email: string; temporaryPassword: string } | null>(null);
  const [credentials, setCredentials] = useState<any[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [importing, setImporting] = useState<File | null>(null);
  const [allOrNothing, setAllOrNothing] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: () => api("/participants", { body: { ...form, teamId: form.teamId || null } }),
    onSuccess: (res: any) => {
      if (res.temporaryPassword) {
        setTemp({ name: res.participant.name, username: res.participant.username, email: res.participant.email, temporaryPassword: res.temporaryPassword });
        toast("Participant created", "success");
      } else {
        toast(`Participant created. ${res.participant.name} signs in with Google using ${res.participant.email}`, "success");
      }
      setForm({ name: "", username: "", email: "", role: "PARTICIPANT", teamId: "" });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : "Failed to create"),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api(`/participants/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
      toast("Participant updated", "success");
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Update failed", "error"),
  });

  const resetPw = useMutation({
    mutationFn: (id: string) => api<{ name: string; username: string; email: string; temporaryPassword: string }>(`/participants/${id}/reset-password`, { body: {} }),
    onSuccess: (res) => setTemp(res),
    onError: (e) => toast(e instanceof ApiError ? e.message : "Reset failed", "error"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/participants/${id}`, { method: "PATCH", body: { softDelete: true } }),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["participants"] });
      toast("Participant removed", "success");
    },
  });

  const runPreview = async (file: File) => {
    try {
      setPreview(await upload("/participants/import/preview", file));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Import failed", "error");
    }
  };

  const handleFile = (file: File | null) => {
    setImporting(file);
    setPreview(null);
    if (file) runPreview(file);
  };

  const runCommit = async () => {
    if (!importing) return;
    try {
      const res = await upload("/participants/import/commit", importing, { allOrNothing: String(allOrNothing) });
      setCredentials(res.credentials);
      setPreview(null);
      setImporting(null);
      toast(`Imported ${res.committed} participants (${res.skipped} skipped)`, "success");
      qc.invalidateQueries({ queryKey: ["participants"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Commit failed", "error");
    }
  };

  const rows = listQ.data?.participants ?? [];
  const activeCount = rows.filter((row) => row.status === "ACTIVE").length;
  const teamCount = new Set(rows.map((row) => row.team?.id).filter(Boolean)).size;
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.name, row.username, row.email, row.role, row.team?.name ?? ""].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [rows, search]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      toast("Copied to clipboard", "success");
    } catch {
      toast("Could not copy", "error");
    }
  };

  return (
    <>
      <PageTitle

        title="Participants"
        subtitle="Add participants, bulk import from CSV or XLSX, and manage credentials."
        actions={
          <Button variant="secondary" onClick={async () => downloadBlob("/participants/import/template?format=csv")}>
            <IconDownload size={15} />
            Download template
          </Button>
        }
      />

      <div className="mb-6">
          <StatStrip columns={3}>
        <StatCard label="Total people" value={listQ.isLoading ? <Skeleton className="h-7 w-10" /> : rows.length} />
        <StatCard label="Active accounts" value={listQ.isLoading ? <Skeleton className="h-7 w-10" /> : activeCount} />
        <StatCard label="Teams represented" value={listQ.isLoading ? <Skeleton className="h-7 w-10" /> : teamCount} />
          </StatStrip>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        {/* add single participant */}
        <Card className="xl:sticky xl:top-6">
          <div className="flex items-start gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-ink-900">Add participant</h2>
              <p className="mt-0.5 text-[13px] text-ink-500">A temporary password is issued automatically.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <LabelledInput label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Carla Mendes" />
            <LabelledInput label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. carla" autoComplete="off" />
            <LabelledInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="carla@company.com" autoComplete="off" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LabelledSelect label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="PARTICIPANT">Participant</option>
                <option value="MODERATOR">Moderator</option>
                <option value="ADMIN">Admin</option>
              </LabelledSelect>
              <LabelledSelect label="Team (optional)" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                <option value="">No team</option>
                {teamsQ.data?.teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </LabelledSelect>
            </div>
            {formError && <ErrorBox>{formError}</ErrorBox>}
            <Button
              className="w-full"
              onClick={() => {
                setFormError(null);
                if (!form.name || !form.username || !form.email) return setFormError("Name, username, and email are required");
                create.mutate();
              }}
              disabled={create.isPending}
            >
              {create.isPending ? "Creating…" : "Create & issue password"}
            </Button>
          </div>
        </Card>

        {/* bulk import */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-ink-900">Bulk import</h2>
                <p className="mt-0.5 text-[13px] text-ink-500">Preview every row before committing. CSV or XLSX.</p>
              </div>
            </div>
            <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[13px] font-medium text-ink-500">
              Up to 5,000 rows
            </span>
          </div>

          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleFile(event.dataTransfer.files?.[0] ?? null);
            }}
            className={`group mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragActive
                ? "border-brand-400 bg-brand-50"
                : "border-ink-200 bg-ink-50/40 hover:border-brand-300 hover:bg-brand-50/40"
            }`}
          >
            <span className="sr-only">Import file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              aria-label="Import file"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <span className="mt-3 text-sm font-semibold text-ink-800">
              Drop a file here, or <span className="text-brand-600">browse</span>
            </span>
            <span className="mt-1 text-[13px] text-ink-400">CSV, XLSX or XLS · max 5 MB</span>
            {importing && (
              <span className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[13px] font-medium text-ink-600 ring-1 ring-line">
                <IconFile size={13} className="shrink-0 text-brand-500" />
                <span className="truncate">{importing.name}</span>
              </span>
            )}
          </label>

          <ol aria-label="Import steps" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["1", "Choose a file"],
              ["2", "Review the preview"],
              ["3", "Commit valid rows"],
            ].map(([step, label]) => (
              <li
                key={step}
                className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-medium text-ink-600"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ocean-50 text-[13px] font-medium text-ocean-600 ring-1 ring-inset ring-ocean-100">
                  {step}
                </span>
                {label}
              </li>
            ))}
          </ol>

          <div className="mt-3 rounded-xl border border-line bg-ink-50/40 px-3.5 py-3">
            <CheckRow label="All-or-nothing — only commit if every row is valid" checked={allOrNothing} onChange={setAllOrNothing} />
          </div>

          {preview && (
            <div className="mt-4 animate-fade-in">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-600">{preview.rowCount} rows</span>
                <span className="rounded-full bg-jade-50 px-2.5 py-1 font-semibold text-jade-700 ring-1 ring-inset ring-jade-200">{preview.validCount} valid</span>
                {preview.errorCount > 0 && (
                  <span className="rounded-full bg-coral-50 px-2.5 py-1 font-semibold text-coral-700 ring-1 ring-inset ring-coral-200">{preview.errorCount} with errors</span>
                )}
              </div>
              <div className="mt-3 max-h-56 overflow-auto scrollbar-slim rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-ink-50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Row</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Name</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.rows.map((row: any) => (
                      <tr key={row.row}>
                        <td className="px-3 py-2 text-ink-500">{row.row}</td>
                        <td className="px-3 py-2 font-medium text-ink-800">{row.name ?? "—"}</td>
                        <td className={`px-3 py-2 ${row.valid ? "text-jade-700" : "text-coral-700"}`}>
                          {row.valid ? "Ready" : row.errors.join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button className="mt-3" onClick={runCommit} disabled={preview.errorCount > 0 && allOrNothing}>
                Commit {preview.validCount} valid row{preview.validCount === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {(temp || credentials) && (
            <div className="mt-4 animate-fade-in overflow-hidden rounded-2xl border border-gold-200 bg-gold-50/70">
              <div className="flex items-center gap-2 border-b border-gold-200/70 px-4 py-3">
                <p className="text-[13px] font-medium text-gold-800">
                  Temporary password — shown only once
                </p>
              </div>
              <div className="space-y-2 px-4 py-3.5 text-sm text-ink-700">
                {temp && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{temp.name} ({temp.username}):</span>
                    <code className="rounded-md bg-white px-2 py-1 font-mono text-[13px] font-semibold text-ink-900 ring-1 ring-gold-200">
                      {temp.temporaryPassword}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(temp.temporaryPassword)}
                      aria-label="Copy temporary password"
                      className="grid h-7 w-7 place-items-center rounded-lg text-gold-700 transition hover:bg-white"
                    >
                      <IconCopy size={13} />
                    </button>
                  </div>
                )}
                {credentials && credentials.length > 0 && (
                  <>
                    <ul className="space-y-1">
                      {credentials.slice(0, 5).map((credential: any) => (
                        <li key={credential.username} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="font-medium">{credential.username}:</span>
                          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-ink-800 ring-1 ring-gold-200">
                            {credential.temporaryPassword}
                          </code>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="secondary"
                      className="mt-1"
                      onClick={async () => {
                        const b = await download("/participants/credentials-sheet", { format: "csv", credentials });
                        saveBlob(b.blob, b.filename);
                      }}
                    >
                      <IconDownload size={14} />
                      Download credentials sheet
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* participant list */}
      <div className="mt-8">
        <SectionHeading
          title="All participants"
          count={rows.length}
          description="Search across names, usernames, emails, and teams."
          action={
            <div className="relative w-full sm:w-72">
              <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search participants…"
                aria-label="Search participants"
                className={`${fieldClass} py-2 pl-9`}
              />
            </div>
          }
        />
        {listQ.isLoading ? (
          <Skeleton className="h-56 rounded-2xl" />
        ) : rows.length === 0 ? (
          <EmptyState title="No participants yet" hint="Add one above or import a roster from a file." icon={<IconUsers size={22} />} />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="No matches"
            hint={`Nothing matches “${search}”. Try a different name, username, or team.`}
            icon={<IconSearch size={22} />}
            action={<Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button>}
          />
        ) : (
          <DataTable head={["Name", "Username", "Email", "Role", "Team", "Status", "Actions"]}>
            {filteredRows.map((participant) => (
              <tr key={participant.id}>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-[13px] font-medium text-ink-800">
                      {initials(participant.name)}
                    </span>
                    <span className="font-medium text-ink-900">{participant.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-[13px] text-ink-600">@{participant.username}</td>
                <td className="px-4 py-3.5 text-ink-600">{participant.email}</td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[13px] font-bold   ring-1 ring-inset ${ROLE_STYLES[participant.role] ?? ROLE_STYLES.PARTICIPANT}`}>
                    {participant.role.toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {participant.team ? (
                    <span className="rounded-lg bg-ink-50 px-2 py-1 text-[13px] font-medium text-ink-600 ring-1 ring-inset ring-line">
                      {participant.team.name}
                    </span>
                  ) : (
                    <span className="text-[13px] text-ink-400">No team</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600">
                    <span className={`h-1.5 w-1.5 rounded-full ${participant.status === "ACTIVE" ? "bg-jade-500" : "bg-coral-500"}`} />
                    {participant.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-0.5">
                    <Button variant="ghost" className="px-2 py-1.5 text-[13px]" onClick={() => patch.mutate({ id: participant.id, body: { status: participant.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } })}>
                      {participant.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </Button>
                    <Button variant="ghost" className="px-2 py-1.5 text-[13px]" onClick={() => resetPw.mutate(participant.id)}>
                      Reset password
                    </Button>
                    <Button variant="dangerGhost" className="px-2 py-1.5 text-[13px]" onClick={() => setConfirmDelete(participant)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete participant?"
        body={`${confirmDelete?.name} will be deactivated and removed from lists. Historical results are preserved.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && del.mutate(confirmDelete.id)}
      />
    </>
  );
}

async function downloadBlob(path: string) {
  const b = await download(path);
  saveBlob(b.blob, b.filename);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
