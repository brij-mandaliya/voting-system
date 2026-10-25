/**
 * Support for "one row per team" sign-up exports (Google Forms, Typeform, ...):
 * a team-name column plus several member-email columns, no names or usernames.
 * Each team row is expanded into one participant row per member so the regular
 * team import pipeline can validate and commit it. Every automatic correction
 * is recorded as a note so the admin sees it in the preview before committing.
 */
import { sanitizeText } from "../utils/sanitize";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_RE = /^(n\/?a|na|none|nil|null|-+|—|–|\.)$/i;
const REJECTED_RE = /^(false|no|n|0|rejected|not approved)$/i;

export interface FormExportColumns {
  team: string;
  members: { key: string; label: string; leader: boolean }[];
  submitter: string | null;
  description: string | null;
  approval: string | null;
}

/** A team row expanded into participant rows (same shape as a template row). */
export interface ExpandedRow {
  line: number;
  teamName: string;
  teamDescription: string;
  projectTitle: string;
  participantName: string;
  participantEmail: string;
  participantUsername: string;
  participantRole: string;
  hasParticipant: boolean;
  /** Username/name were not in the file and must be derived from the email. */
  deriveIdentity: boolean;
  notes: string[];
  errors: string[];
}

/**
 * Recognises a form export from its (normalised) headers: a team-name column
 * and at least one member-email column. Returns null for the template format.
 */
export function detectFormExport(fields: string[], labels: Record<string, string>): FormExportColumns | null {
  const memberish = /(leader|member|participant|teammate|mate|captain|partner)/;
  const members = fields
    .filter((f) => /email|e_mail|mail/.test(f) && memberish.test(f))
    .map((key) => ({ key, label: labels[key] ?? key, leader: /(leader|captain)/.test(key) }));
  if (members.length === 0) return null;

  const team = fields.find((f) => f === "teamName" || (/team/.test(f) && /name/.test(f) && !/email/.test(f)));
  if (!team) return null;

  const submitter =
    fields.find((f) => f === "email_address" || f === "participantEmail" || f === "email" || f === "your_email") ?? null;
  const approval = fields.find((f) => /approv/.test(f)) ?? null;
  const description =
    fields.find((f) => f !== approval && /(idea|project|problem|solution|description)/.test(f) && /(detail|description|summary|about)/.test(f)) ??
    fields.find((f) => f !== approval && f !== team && /(idea|description|project)/.test(f)) ??
    null;
  return { team, members, submitter, description, approval };
}

/** Display name taken from an email: its local part. */
export function nameFromEmail(email: string) {
  return email.split("@")[0];
}

/** Username base from an email local part, constrained to the app's username rules. */
export function usernameBaseFromEmail(email: string) {
  let base = email.split("@")[0].toLowerCase().replace(/\+.*$/, "").replace(/[^a-z0-9._-]/g, "");
  base = base.replace(/^[._-]+|[._-]+$/g, "");
  if (base.length < 3) base = `${base || "user"}-member`;
  return base.slice(0, 56); // leaves room for a "-NN" suffix within 60 chars
}

export function expandFormExport(data: Record<string, unknown>[], cols: FormExportColumns): ExpandedRow[] {
  const out: ExpandedRow[] = [];
  const text = (row: Record<string, unknown>, key: string | null) => (key ? sanitizeText(row[key]) : "");

  data.forEach((row, index) => {
    const line = index + 2; // header is line 1
    const rawTeam = text(row, cols.team);
    const teamName = rawTeam.replace(/\s+/g, " ").trim();
    const teamNotes: string[] = [];
    const teamErrors: string[] = [];
    if (String(row[cols.team] ?? "") !== teamName && teamName) teamNotes.push("Removed extra spaces from the team name");

    const approval = text(row, cols.approval);
    if (cols.approval && REJECTED_RE.test(approval)) teamErrors.push("Idea not approved in the form");

    const description = text(row, cols.description);
    const submitterRaw = text(row, cols.submitter).toLowerCase();
    const submitter = EMAIL_RE.test(submitterRaw) ? submitterRaw : "";

    const emails: { email: string; notes: string[]; error?: string; leader: boolean }[] = [];
    const seen = new Set<string>();
    let usedSubmitter = false;
    for (const col of cols.members) {
      const value = text(row, col.key);
      if (!value) continue;
      if (PLACEHOLDER_RE.test(value)) {
        teamNotes.push(`Skipped the "${value}" placeholder in "${col.label}"`);
        continue;
      }
      if (!EMAIL_RE.test(value)) {
        if (col.leader && submitter && !seen.has(submitter)) {
          emails.push({
            email: submitter,
            leader: true,
            notes: [`"${col.label}" was "${value}", not an email; used the form submitter's email instead`],
          });
          seen.add(submitter);
          usedSubmitter = true;
        } else {
          emails.push({ email: value, leader: col.leader, notes: [], error: `"${col.label}" is not an email: "${value}"` });
        }
        continue;
      }
      const email = value.toLowerCase();
      if (seen.has(email)) {
        teamNotes.push(`${email} is listed twice for this team; imported once`);
        continue;
      }
      seen.add(email);
      emails.push({ email, leader: col.leader, notes: value !== email ? ["Email lowercased"] : [] });
    }
    if (submitter && !usedSubmitter && !seen.has(submitter)) {
      teamNotes.push(`Form submitted by ${submitter}, who isn't listed as a member; not imported`);
    }

    const base = {
      line,
      teamName,
      teamDescription: description,
      projectTitle: "",
      participantUsername: "",
      participantRole: "",
      deriveIdentity: true,
    };
    if (emails.length === 0) {
      out.push({
        ...base,
        participantName: "",
        participantEmail: "",
        hasParticipant: false,
        notes: [...teamNotes, "No member emails in this row; the team is created without members"],
        errors: teamErrors,
      });
      return;
    }
    emails.forEach((member, i) => {
      out.push({
        ...base,
        participantName: member.error ? "" : nameFromEmail(member.email),
        participantEmail: member.error ? "" : member.email,
        hasParticipant: true,
        // team-level notes are shown once, on the team's first row
        notes: [...(i === 0 ? teamNotes : []), ...(member.leader ? ["Team leader"] : []), ...member.notes],
        errors: [...teamErrors, ...(member.error ? [member.error] : [])],
      });
    });
  });
  return out;
}
