import type { Request } from "express";
import { userRepo } from "../repositories/user.repo";
import { teamRepo } from "../repositories/team.repo";
import { sessionRepo } from "../repositories/session.repo";
import { audit } from "../repositories/audit.repo";
import { authService } from "./auth.service";
import { badRequest, conflict, notFound } from "../utils/errors";
import { sanitizeText } from "../utils/sanitize";
import { env } from "../config";
import { parse } from "papaparse";
import ExcelJS from "exceljs";
import { plainify } from "../utils/plainify";
import { publicUser, publicUsers } from "../utils/serialize";
import { prisma } from "../db";
import { clearLockout } from "../middleware/rateLimit";
import type { Prisma } from "@prisma/client";

export interface TempCredential {
  username: string;
  email: string;
  name: string;
  temporaryPassword: string;
}

export const participantService = {
  async list() {
    return publicUsers(await userRepo.list());
  },

  async create(input: { name: string; username: string; email: string; role: string; teamId?: string | null }, actorId: string, ip?: string) {
    const username = sanitizeText(input.username).toLowerCase();
    const email = sanitizeText(input.email).toLowerCase();
    await assertUnique(username, email);

    const { temporaryPassword: tempPassword, data: credentials } = await authService.initialCredentials(input.role as never);
    const user = await userRepo.create({
      name: sanitizeText(input.name),
      username,
      email,
      role: input.role as never,
      teamId: input.teamId ?? null,
      ...credentials,
    });
    audit({
      actorId,
      action: "participant.create",
      entityType: "user",
      entityId: user.id,
      after: { username, email, role: input.role, teamId: input.teamId ?? null },
      ip,
    });
    return { user: publicUser(user), tempPassword };
  },

  async patch(id: string, patch: Record<string, unknown>, actorId: string, ip?: string) {
    const user = await userRepo.findById(id);
    if (!user) throw notFound("Participant not found");

    const losesAdmin =
      user.role === "ADMIN" &&
      (patch.softDelete === true ||
        (typeof patch.role === "string" && patch.role !== "ADMIN") ||
        patch.status === "INACTIVE");
    if (losesAdmin) await assertAnotherActiveAdmin(id);

    if (patch.softDelete === true) {
      await userRepo.softDelete(id);
      await sessionRepo.deleteAllForUser(id);
      audit({ actorId, action: "participant.soft_delete", entityType: "user", entityId: id, before: snapshot(user), ip });
      return { deleted: true };
    }

    const data: Record<string, unknown> = {};
    if (typeof patch.name === "string") data.name = sanitizeText(patch.name);
    if (typeof patch.username === "string") {
      const username = sanitizeText(patch.username).toLowerCase();
      if (username !== user.username) {
        const existing = await userRepo.findByUsername(username);
        if (existing) throw conflict("Username already taken");
        data.username = username;
      }
    }
    if (typeof patch.email === "string") {
      const email = sanitizeText(patch.email).toLowerCase();
      if (email !== user.email) {
        const existing = await userRepo.findByEmail(email);
        if (existing) throw conflict("Email already in use");
        data.email = email;
      }
    }
    if (typeof patch.role === "string") data.role = patch.role;
    if (typeof patch.status === "string") {
      data.status = patch.status;
      if (patch.status === "INACTIVE") {
        // revoke access immediately
        await sessionRepo.deleteAllForUser(id);
      }
    }
    if (patch.teamId !== undefined) data.teamId = patch.teamId;

    const updated = await userRepo.update(id, data as Prisma.UserUncheckedUpdateInput);
    audit({
      actorId,
      action: "participant.update",
      entityType: "user",
      entityId: id,
      before: snapshot(user),
      after: plainify(data),
      ip,
    });
    return publicUser(updated);
  },

  /** Admin password reset → new one-time temporary password, forces change at next login. */
  async resetPassword(id: string, actorId: string, ip?: string): Promise<TempCredential> {
    const user = await userRepo.findById(id);
    if (!user) throw notFound("Participant not found");
    const tempPassword = authService.generateTemporaryPassword();
    const passwordHash = await authService.hashPassword(tempPassword);
    await userRepo.update(id, { passwordHash, mustChangePassword: true, hasPassword: true });
    await sessionRepo.deleteAllForUser(id);
    clearLockout(user.username, user.email); // a locked-out participant can sign in right away
    audit({ actorId, action: "participant.reset_password", entityType: "user", entityId: id, ip });
    return { username: user.username, email: user.email, name: user.name, temporaryPassword: tempPassword };
  },

  /* --------------------------- bulk import ---------------------------- */

  async buildTemplate(kind: "csv" | "xlsx") {
    const header = ["name", "email", "username", "team_name", "role"];
    const rows = [
      ["Ada Lovelace", "ada@example.org", "ada", "Team Alpha", "PARTICIPANT"],
      ["Grace Hopper", "grace@example.org", "grace_h", "Team Beta", "MODERATOR"],
    ];
    if (kind === "csv") {
      return { header, rows, contentType: "text/csv", filename: "participants_template.csv", asWorkbook: null };
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Participants");
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(r));
    return { header, rows, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "participants_template.xlsx", asWorkbook: wb };
  },

  /** Dry-run: parse, validate every row, return errors + a commit token. */
  async previewImport(buffer: Buffer<ArrayBufferLike>, filename: string) {
    const rows = await parseFile(buffer, filename);
    if (rows.length > env.IMPORT_MAX_ROWS) {
      throw badRequest(`File exceeds the row limit (${env.IMPORT_MAX_ROWS} rows)`);
    }
    const teams = await teamRepo.list();
    const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));

    const seen = new Set<string>();
    const report: {
      row: number;
      name?: string;
      valid: boolean;
      errors: string[];
      resolved?: { name: string; username: string; email: string; role: string; teamId: string | null };
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = sanitizeText(row.name);
      const email = sanitizeText(row.email).toLowerCase();
      const username = sanitizeText(row.username).toLowerCase();
      const teamName = sanitizeText(row.team_name);
      const roleRaw = sanitizeText(row.role || "PARTICIPANT").toUpperCase();
      const errors: string[] = [];

      if (!name) errors.push("Missing name");
      if (!email) errors.push("Missing email");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email");
      if (!username) errors.push("Missing username");
      else if (!/^[a-z0-9._-]{3,60}$/.test(username)) errors.push("Invalid username (a-z 0-9 . _ -, 3-60 chars)");
      if (roleRaw && !["ADMIN", "MODERATOR", "PARTICIPANT"].includes(roleRaw)) errors.push(`Invalid role: ${roleRaw}`);

      let teamId: string | null = null;
      if (teamName) {
        const t = teamByName.get(teamName.toLowerCase());
        if (!t) errors.push(`Unknown team: ${teamName}`);
        else teamId = t.id;
      }

      const dupKey = username || email;
      if (dupKey && seen.has(dupKey)) errors.push("Duplicate within file");
      if (dupKey) seen.add(dupKey);
      if (username) {
        const existing = await userRepo.findByUsername(username);
        if (existing) errors.push("Duplicate in database (username)");
      }
      if (email && !errors.some((e) => e.startsWith("Duplicate in database"))) {
        const existingEmail = await userRepo.findByEmail(email);
        if (existingEmail) errors.push("Duplicate in database (email)");
      }

      report.push({
        row: i + 2, // header is row 1
        name: name || undefined,
        valid: errors.length === 0,
        errors,
        ...(errors.length === 0
          ? { resolved: { name, email, username, role: roleRaw || "PARTICIPANT", teamId } }
          : {}),
      });
    }

    const validCount = report.filter((r) => r.valid).length;
    // For real multi-request commit support this stores the parsed file in a job
    // store; for a single-instance deployment we re-parse at commit time.
    return {
      rowCount: rows.length,
      validCount,
      errorCount: report.filter((r) => !r.valid).length,
      rows: report,
      note: "Commit re-validates; keep the same file to commit these exact rows.",
    };
  },

  async commitImport(buffer: Buffer<ArrayBufferLike>, filename: string, allOrNothing: boolean, actorId: string, ip?: string) {
    const preview = await this.previewImport(buffer, filename);
    const validRows = preview.rows.filter((r) => r.valid).map((r) => r.resolved!);
    if (preview.errorCount > 0 && allOrNothing) {
      throw badRequest(`All-or-nothing: file has ${preview.errorCount} invalid rows`, preview.rows);
    }
    const created: TempCredential[] = [];
    let committed = 0;
    for (const row of validRows) {
      // re-check uniqueness (concurrent writes since preview)
      const existing = await userRepo.findByUsername(row.username);
      const existingEmail = await userRepo.findByEmail(row.email);
      if (existing || existingEmail) continue;
      const { temporaryPassword, data: credentials } = await authService.initialCredentials(row.role as never);
      await userRepo.create({
        name: row.name,
        username: row.username,
        email: row.email,
        role: row.role as never,
        teamId: row.teamId,
        ...credentials,
      });
      committed++;
      if (temporaryPassword) created.push({ username: row.username, email: row.email, name: row.name, temporaryPassword });
    }
    audit({
      actorId,
      action: "participant.bulk_import",
      entityType: "import",
      entityId: filename,
      after: { committed, skipped: preview.errorCount, mode: allOrNothing ? "all_or_nothing" : "valid_only" },
      ip,
    });
    return { committed, skipped: preview.errorCount, credentials: created };
  },

  /** Credentials sheet: one-time download of generated temp passwords. */
  async buildCredentialsSheet(credentials: TempCredential[], kind: "csv" | "xlsx") {
    const header = ["name", "username", "email", "temporary_password"];
    if (kind === "csv") {
      const lines = [header.join(",")].concat(
        credentials.map((c) =>
          [c.name, c.username, c.email, c.temporaryPassword]
            .map((v) => `"${v.replace(/"/g, '""')}"`)
            .join(",")
        )
      );
      return { contentType: "text/csv", filename: "credentials.csv", buffer: Buffer.from(lines.join("\n")) };
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Credentials");
    ws.addRow(header);
    credentials.forEach((c) => ws.addRow([c.name, c.username, c.email, c.temporaryPassword]));
    const out = await wb.xlsx.writeBuffer();
    return {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "credentials.xlsx",
      buffer: Buffer.from(out as ArrayBuffer),
    };
  },
};

function snapshot(user: { name: string; username: string; email: string; role: string; status: string; teamId: string | null }) {
  return { name: user.name, username: user.username, email: user.email, role: user.role, status: user.status, teamId: user.teamId };
}

async function assertUnique(username: string, email: string) {
  if (await userRepo.findByUsername(username)) throw conflict("Username already taken");
  if (await userRepo.findByEmail(email)) throw conflict("Email already in use");
}

interface ParsedRow {
  name: string;
  email: string;
  username: string;
  team_name: string;
  role: string;
}

async function parseFile(buffer: Buffer<ArrayBufferLike>, filename: string): Promise<ParsedRow[]> {
  const isXlsx = filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls");
  if (!isXlsx) {
    const csv = parse<ParsedRow>(buffer.toString("utf8"), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    if (csv.errors.length) throw badRequest(`CSV parse error: ${csv.errors[0].message}`);
    return csv.data;
  }
  const wb = new ExcelJS.Workbook();
  const parsed = await wb.xlsx.load(buffer as never);
  const ws = parsed.worksheets[0];
  if (!ws) throw badRequest("Empty spreadsheet");
  const rows: ParsedRow[] = [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = sanitizeText(cell.value).toLowerCase();
  });
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    let hasContent = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = row.getCell(col);
      const text = sanitizeText(v.text);
      if (text) hasContent = true;
      obj[h] = text;
    });
    if (hasContent) rows.push(obj as unknown as ParsedRow);
  }
  return rows;
}

/** Never leave the system without an active admin (demote / deactivate / delete). */
async function assertAnotherActiveAdmin(userId: string) {
  const others = await prisma.user.count({
    where: { role: "ADMIN", status: "ACTIVE", deletedAt: null, id: { not: userId } },
  });
  if (others === 0) throw conflict("This is the only active admin. Promote another admin first.");
}
