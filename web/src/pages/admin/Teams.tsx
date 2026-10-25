import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, download, upload, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  CheckRow,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorBox,
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
  IconDownload,
  IconFile,
  IconTeams,
  IconUpload,
  IconUsers,
} from "../../components/icons";

interface ImportParticipant {
  name: string;
  email: string;
  username: string;
  role: string;
  existingUserId?: string;
}

/** Room-select value meaning "create a new room during the import". */
const NEW_ROOM = "__new__";

interface ImportRow {
  row: number;
  notes?: string[];
  teamName?: string;
  participant?: ImportParticipant;
  valid: boolean;
  errors: string[];
}

interface ImportPreview {
  filename: string;
  format: "template" | "form-export";
  formatNotes: string[];
  room: { id: string; name: string; status: string } | null;
  newRoom: { name: string; status: string; categories: { name: string; minScore: number; maxScore: number; weight: number }[] } | null;
  rowCount: number;
  teamCount: number;
  participantCount: number;
  validRowCount: number;
  validTeamCount: number;
  validParticipantCount: number;
  errorCount: number;
  rows: ImportRow[];
  teams: { name: string; valid: boolean; errors: string[] }[];
}

interface ImportResult {
  room: { id: string; name: string; created?: boolean } | null;
  teamsCreated: number;
  teamsFailed: number;
  participantsCreated: number;
  participantsAssigned: number;
  rowsCommitted: number;
  rowsSkipped: number;
  credentials: { name: string; username: string; email: string; temporaryPassword: string; teamName: string }[];
  failed: { row: number; teamName: string | null; errors: string[] }[];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function Teams() {
  const qc = useQueryClient();
  const toast = useToast();
  const listQ = useQuery({ queryKey: ["teams"], queryFn: () => api<{ teams: any[] }>("/teams") });
  const roomsQ = useQuery({ queryKey: ["rooms"], queryFn: () => api<{ rooms: any[] }>("/rooms") });
  const [form, setForm] = useState({ name: "", description: "", projectTitle: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  /* ----------------------------- bulk import ----------------------------- */
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRoomId, setImportRoomId] = useState("");
  // "__new__" in the room select: create a draft room with starter categories during the import
  const [newRoomName, setNewRoomName] = useState("");
  const creatingRoom = importRoomId === NEW_ROOM;
  const [allOrNothing, setAllOrNothing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // a double-click must not start a second, concurrent import
  const [committing, setCommitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const roomFields = (roomId: string, roomName: string): Record<string, string> =>
    roomId === NEW_ROOM ? (roomName.trim() ? { newRoomName: roomName.trim() } : {}) : roomId ? { roomId } : {};

  const runPreview = async (file: File, roomId = importRoomId, roomName = newRoomName) => {
    try {
      setImportError(null);
      const data = await upload("/teams/import/preview", file, roomFields(roomId, roomName));
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setImportError(e instanceof ApiError ? e.message : "Import preview failed");
    }
  };

  const handleFile = (file: File | null) => {
    setImportFile(file);
    setPreview(null);
    setImportResult(null);
    setImportError(null);
    if (file) void runPreview(file);
  };

  const changeRoom = (roomId: string) => {
    setImportRoomId(roomId);
    // The preview validates the selected room, so refresh it if a file is loaded.
    if (importFile) void runPreview(importFile, roomId);
  };

  const runCommit = async () => {
    if (!importFile || committing) return;
    setCommitting(true);
    try {
      setImportError(null);
      const data = (await upload("/teams/import/commit", importFile, {
        ...roomFields(importRoomId, newRoomName),
        allOrNothing: String(allOrNothing),
      })) as ImportResult;
      setImportResult(data);
      setPreview(null);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast(
        `Imported ${data.teamsCreated} team${data.teamsCreated === 1 ? "" : "s"} and ${data.participantsCreated + data.participantsAssigned} participant${data.participantsCreated + data.participantsAssigned === 1 ? "" : "s"}`,
        "success"
      );
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      if (data.room) {
        qc.invalidateQueries({ queryKey: ["roomTeams", data.room.id] });
        qc.invalidateQueries({ queryKey: ["members", data.room.id] });
      }
      if (creatingRoom) {
        setImportRoomId("");
        setNewRoomName("");
      }
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  const create = useMutation({
    mutationFn: () => api("/teams", { body: { ...form, links: [] } }),
    onSuccess: () => {
      setForm({ name: "", description: "", projectTitle: "" });
      setError(null);
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast("Team created", "success");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast("Team deleted", "success");
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Delete failed", "error"),
  });

  const teams = listQ.data?.teams ?? [];
  const rooms = (roomsQ.data?.rooms ?? []).filter((room) => room.status !== "ARCHIVED");
  const totalMembers = teams.reduce((sum: number, team: any) => sum + (team._count?.members ?? 0), 0);
  const projects = teams.filter((team: any) => team.projectTitle).length;

  return (
    <>
      <PageTitle
        title="Teams"
        subtitle="Organization-level teams, linked to rooms one event at a time."
      />

      <div className="mb-6">
        <StatStrip columns={3}>
          <StatCard label="Teams" value={listQ.isLoading ? <Skeleton className="h-7 w-10" /> : teams.length} />
          <StatCard label="Members" value={listQ.isLoading ? <Skeleton className="h-7 w-10" /> : totalMembers} />
          <StatCard label="Projects showcased" value={listQ.isLoading ? <Skeleton className="h-7 w-10" /> : projects} />
        </StatStrip>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-start gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-ink-900">New team</h2>
                <p className="mt-0.5 text-[13px] text-ink-500">Create the team once, link it to any room.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <LabelledInput label="Team name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Team Aurora" />
              <LabelledInput label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this team work on?" />
              <LabelledInput label="Project title (optional)" value={form.projectTitle} onChange={(e) => setForm({ ...form, projectTitle: e.target.value })} placeholder="e.g. Atlas — smarter dispatch" />
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button
                className="w-full"
                onClick={() => {
                  if (!form.name.trim()) return setError("Team name is required");
                  create.mutate();
                }}
                disabled={create.isPending}
              >
                {create.isPending ? "Creating…" : "Create team"}
              </Button>
            </div>
          </Card>

          {/* bulk import */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold text-ink-900">Bulk import teams</h2>
                <p className="mt-0.5 text-[13px] text-ink-500">Create teams and their members from one CSV.</p>
              </div>
              <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[13px] font-medium text-ink-500">CSV</span>
            </div>

            <div className="mt-4 space-y-3">
              <LabelledSelect
                label="Assign imported teams to room (optional)"
                value={importRoomId}
                onChange={(e) => changeRoom(e.target.value)}
              >
                <option value="">No room — teams only</option>
                <option value={NEW_ROOM}>+ Create a new room…</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.status.toLowerCase()})
                  </option>
                ))}
              </LabelledSelect>
              {creatingRoom && (
                <LabelledInput
                  label="New room name"
                  value={newRoomName}
                  placeholder="e.g. Hacktoberfest finals"
                  maxLength={120}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  onBlur={() => importFile && void runPreview(importFile)}
                  hint="Created as a draft with starter categories"
                />
              )}

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
                className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-6 text-center transition-colors ${
                  dragActive
                    ? "border-brand-400 bg-brand-50"
                    : "border-ink-200 bg-ink-50/40 hover:border-brand-300 hover:bg-brand-50/40"
                }`}
              >
                <span className="sr-only">Team import CSV file</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Team import CSV file"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <IconUpload size={20} className="text-ink-400 group-hover:text-brand-500" />
                <span className="mt-2 text-sm font-semibold text-ink-800">
                  Drop a CSV here, or <span className="text-brand-600">browse</span>
                </span>
                <span className="mt-1 text-[13px] text-ink-400">One row per participant, or a sign-up form export (one row per team) · max 5 MB</span>
                {importFile && (
                  <span className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[13px] font-medium text-ink-600 ring-1 ring-line">
                    <IconFile size={13} className="shrink-0 text-brand-500" />
                    <span className="truncate">{importFile.name}</span>
                  </span>
                )}
              </label>

              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-500">
                <span>Repeat <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[12px] text-ink-700">team_name</code> to add multiple participants.</span>
                <Button variant="ghost" className="h-auto px-2 py-1 text-[13px]" onClick={() => downloadBlob("/teams/import/template")}>
                  <IconDownload size={14} />
                  Download template
                </Button>
              </div>

              <div className="rounded-xl border border-line bg-ink-50/40 px-3.5 py-3">
                <CheckRow label="All-or-nothing — only import if every row is valid" checked={allOrNothing} onChange={setAllOrNothing} />
              </div>

              {importError && <ErrorBox>{importError}</ErrorBox>}

              {preview && (
                <div className="animate-fade-in">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-600">{preview.teamCount} teams</span>
                    <span className="rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-600">{preview.participantCount} participants</span>
                    <span className="rounded-full bg-jade-50 px-2.5 py-1 font-semibold text-jade-700 ring-1 ring-inset ring-jade-200">{preview.validRowCount} valid rows</span>
                    {preview.errorCount > 0 && (
                      <span className="rounded-full bg-coral-50 px-2.5 py-1 font-semibold text-coral-700 ring-1 ring-inset ring-coral-200">{preview.errorCount} with errors</span>
                    )}
                  </div>
                  {preview.format === "form-export" && preview.formatNotes.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-lg bg-ink-50 px-3.5 py-2.5 text-[13px] text-ink-700">
                      {preview.formatNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                  {preview.room && (
                    <p className="mt-2 text-[13px] text-ink-500">
                      Will link every imported team to <span className="font-medium text-ink-800">{preview.room.name}</span> and add members to that room.
                    </p>
                  )}
                  {preview.newRoom && (
                    <div className="mt-2 text-[13px] text-ink-600">
                      <p>
                        Will create the room <span className="font-medium text-ink-900">{preview.newRoom.name}</span> (draft), link every imported team in file
                        order and add all members as voters. Starting categories, editable until the first vote:
                      </p>
                      <p className="mt-1 text-ink-800">
                        {preview.newRoom.categories.map((c) => `${c.name} (${c.minScore}–${c.maxScore})`).join(", ")}
                      </p>
                    </div>
                  )}
                  {creatingRoom && !preview.newRoom && (
                    <p className="mt-2 text-[13px] text-[#92400e]">Enter a name for the new room to include it in this import.</p>
                  )}

                  <div className="mt-3 max-h-60 overflow-auto scrollbar-slim rounded-xl border border-line">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-ink-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Row</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Team</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Participant</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {preview.rows.slice(0, 250).map((row, index) => (
                          <tr key={`${row.row}-${index}`}>
                            <td className="px-3 py-2 text-ink-500">{row.row}</td>
                            <td className="px-3 py-2 font-medium text-ink-800">{row.teamName ?? "—"}</td>
                            <td className="px-3 py-2 text-ink-600">
                              {row.participant?.name ? (
                                <span title={row.participant.email}>
                                  {row.participant.name}
                                  {row.participant.existingUserId && <span className="ml-1 text-ink-400">(existing)</span>}
                                </span>
                              ) : (
                                <span className="text-ink-400">Team only</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className={row.valid ? "text-jade-700" : "text-coral-700"}>{row.valid ? "Ready" : row.errors.join("; ")}</span>
                              {row.notes && row.notes.length > 0 && <span className="block text-[12px] text-ink-500">{row.notes.join(" · ")}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.rows.length > 250 && (
                    <p className="mt-1.5 text-[12px] text-ink-400">Showing the first 250 rows. All rows are validated on commit.</p>
                  )}

                  <Button
                    className="mt-3 w-full"
                    onClick={runCommit}
                    disabled={committing || preview.validTeamCount === 0 || (preview.errorCount > 0 && allOrNothing)}
                    aria-busy={committing}
                  >
                    {committing ? "Importing…" : <>Import {preview.validTeamCount} team{preview.validTeamCount === 1 ? "" : "s"} · {preview.validParticipantCount} participant{preview.validParticipantCount === 1 ? "" : "s"}</>}
                  </Button>
                </div>
              )}

              {importResult && (
                <div className="animate-fade-in overflow-hidden rounded-2xl border border-jade-200 bg-jade-50/60">
                  <div className="border-b border-jade-200/70 px-4 py-3">
                    <p className="text-[13px] font-medium text-jade-800">Import complete</p>
                  </div>
                  <div className="space-y-2 px-4 py-3.5 text-[13px] text-ink-700">
                    <p>
                      Created <strong>{importResult.teamsCreated}</strong> team{importResult.teamsCreated === 1 ? "" : "s"},{" "}
                      <strong>{importResult.participantsCreated}</strong> new participant{importResult.participantsCreated === 1 ? "" : "s"}, and assigned{" "}
                      <strong>{importResult.participantsAssigned}</strong> existing participant{importResult.participantsAssigned === 1 ? "" : "s"}.
                    </p>
                    {importResult.room && (
                      <p>
                        {importResult.room.created ? "Created" : "Linked every team to"} <strong>{importResult.room.name}</strong>
                        {importResult.room.created ? " with all teams and members. " : ". "}
                        Next: assign a moderator and activate it in{" "}
                        <Link to={`/admin/rooms/${importResult.room.id}`} className="font-medium underline underline-offset-4">
                          room setup
                        </Link>
                        .
                      </p>
                    )}
                    {importResult.rowsSkipped > 0 && (
                      <div className="rounded-lg bg-coral-50 px-3 py-2 text-coral-800">
                        <p className="font-medium">{importResult.rowsSkipped} row{importResult.rowsSkipped === 1 ? "" : "s"} skipped</p>
                        <ul className="mt-1 space-y-1">
                          {importResult.failed.slice(0, 20).map((failure) => (
                            <li key={`${failure.row}-${failure.teamName ?? "none"}`}>
                              Row {failure.row}{failure.teamName ? ` · ${failure.teamName}` : ""}: {failure.errors.join("; ")}
                            </li>
                          ))}
                        </ul>
                        {importResult.failed.length > 20 && (
                          <p className="mt-1 text-[12px]">Showing the first 20 failed rows.</p>
                        )}
                      </div>
                    )}
                    {importResult.participantsCreated > 0 && importResult.credentials.length === 0 && (
                      <p>
                        No passwords to share: new participants sign in with <strong>Continue with Google</strong> using
                        the email they registered with.
                      </p>
                    )}
                    {importResult.credentials.length > 0 && (
                      <>
                        <p className="font-medium text-gold-800">Temporary passwords — shown only once</p>
                        <ul className="max-h-40 space-y-1 overflow-auto scrollbar-slim">
                          {importResult.credentials.slice(0, 10).map((credential) => (
                            <li key={credential.username} className="flex flex-wrap items-center gap-2 text-[13px]">
                              <span className="font-medium">{credential.username}:</span>
                              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-ink-800 ring-1 ring-gold-200">
                                {credential.temporaryPassword}
                              </code>
                            </li>
                          ))}
                        </ul>
                        {importResult.credentials.length > 10 && (
                          <p className="text-[12px] text-ink-500">
                            {importResult.credentials.length - 10} more in the credentials sheet.
                          </p>
                        )}
                        <Button
                          variant="secondary"
                          className="mt-1"
                          onClick={async () => {
                            const b = await download("/participants/credentials-sheet", {
                              format: "csv",
                              credentials: importResult.credentials,
                            });
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
            </div>
          </Card>
        </div>

        <div>
          <SectionHeading
            title="All teams"
            count={teams.length}
            description="Teams can be linked to any number of rooms."
          />
          {listQ.isLoading ? (
            <Skeleton className="h-56 rounded-2xl" />
          ) : teams.length === 0 ? (
            <EmptyState
              title="No teams yet"
              hint="Create your first team on the left, then link it to a room."
              icon={<IconTeams size={22} />}
            />
          ) : (
            <DataTable head={["Team", "Project", "Members", "Actions"]}>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-[13px] font-medium text-ink-800">
                        {initials(team.name)}
                      </span>
                      <span className="font-medium text-ink-900">{team.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-ink-600">
                    {team.projectTitle ? (
                      <span className="line-clamp-1">{team.projectTitle}</span>
                    ) : (
                      <span className="text-[13px] text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-2 py-1 text-[13px] font-medium text-ink-600 ring-1 ring-inset ring-line">
                      <IconUsers size={12} className="text-ink-400" />
                      {team._count?.members ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Button
                      variant="dangerGhost"
                      className="px-2 py-1.5 text-[13px]"
                      onClick={() => setConfirmDelete(team)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete team?"
        body={`"${confirmDelete?.name}" will be soft-deleted. Results that reference it are kept.`}
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
