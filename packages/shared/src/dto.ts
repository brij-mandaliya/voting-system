import { z } from "zod";

/* ------------------------------- enums --------------------------------- */
export const roleSchema = z.enum(["ADMIN", "MODERATOR", "PARTICIPANT"]);
export const userStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export const roomStatusSchema = z.enum(["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"]);
export const roundStatusSchema = z.enum(["PENDING", "OPEN", "PAUSED", "CLOSED"]);
export const accessModeSchema = z.enum(["RESTRICTED", "OPEN_WITH_CODE"]);
export const aggregationSchema = z.enum(["weighted_mean", "trimmed_mean"]);

/* --------------------------------- auth -------------------------------- */
export const loginSchema = z.object({
  identifier: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, "Minimum 10 characters").max(128),
});
/** First password for an account that so far only signs in with Google. */
export const setPasswordSchema = changePasswordSchema.pick({ newPassword: true });

/* ----------------------------- participants ---------------------------- */
export const participantCreateSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/, "Letters, digits, . _ - only"),
  email: z.string().email().max(255),
  role: roleSchema.default("PARTICIPANT"),
  teamId: z.string().cuid().nullable().optional(),
});
export const participantPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  email: z.string().email().max(255).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  teamId: z.string().cuid().nullable().optional(),
  softDelete: z.literal(true).optional(),
});
export const bulkImportCommitSchema = z.object({
  /** token returned by the preview call */
  jobId: z.string(),
  allOrNothing: z.boolean().default(false),
});

/* -------------------------------- teams -------------------------------- */
export const teamCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  projectTitle: z.string().max(200).optional().nullable(),
  links: z.array(z.string().url().max(500)).max(10).optional().default([]),
  logoUrl: z.string().url().max(500).optional().nullable(),
});
export const teamPatchSchema = teamCreateSchema.partial();

/** Multipart options for CSV team import (values arrive as strings). */
export const teamImportOptionsSchema = z.object({
  roomId: z
    .union([z.string().cuid(), z.literal(""), z.null(), z.undefined()])
    .optional()
    .transform((value) => value || null),
  allOrNothing: z
    .union([z.boolean(), z.literal("true"), z.literal("false"), z.undefined()])
    .optional()
    .transform((value) => value === true || value === "true"),
  /** Create a new draft room (with starter categories) and import into it. */
  newRoomName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || null),
});

/* -------------------------------- rooms -------------------------------- */
export const roomSettingsSchema = z.object({
  allowVoteEdit: z.boolean().default(true),
  adminCanSeeVoterIdentity: z.boolean().default(true),
  liveResults: z.boolean().default(false),
  minVotesThreshold: z.number().int().min(0).max(10000).default(0),
  aggregationMethod: aggregationSchema.default("weighted_mean"),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export const roomCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  accessMode: accessModeSchema.default("RESTRICTED"),
  settings: roomSettingsSchema.partial().optional(),
});
export const roomPatchSchema = roomCreateSchema.partial(); // name/description/accessMode/settings

/* ----------------------------- room members ---------------------------- */
export const roomMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(["PARTICIPANT", "MODERATOR"]).default("PARTICIPANT"),
  /** null → inherit user's org team; undefined → keep existing */
  teamId: z.string().cuid().nullable().optional(),
});
export const roomMembersPutSchema = z.object({
  members: z.array(roomMemberSchema).max(5000),
});

/* ------------------------------ room teams ----------------------------- */
export const roomTeamSchema = z.object({
  teamId: z.string(),
  presentationOrder: z.number().int().min(1).max(10000).optional(),
  details: z.string().max(2000).optional(),
});
export const roomTeamsPutSchema = z.object({ teams: z.array(roomTeamSchema).max(1000) });

/* ------------------------------ categories ----------------------------- */
export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  minScore: z.number().int().min(-1000).max(100000).default(1),
  maxScore: z.number().int().min(-1000).max(100000).default(10),
  step: z.number().int().min(1).max(1000).default(1),
  weight: z.number().min(0).max(1000).default(1),
  isRequired: z.boolean().default(true),
});
export const categoryPatchSchema = categoryCreateSchema.partial().extend({
  active: z.boolean().optional(), // soft-deactivation (used categories stay for history)
});
export const categoryReorderSchema = z.object({
  order: z.array(z.string()).max(500),
});
export const newConfigVersionSchema = z.object({ reason: z.string().max(500).optional() });

/* ------------------------------- rounds -------------------------------- */
export const selectTeamSchema = z.object({
  teamId: z.string(),
  force: z.boolean().default(false), // re-present a completed team (audited)
});

/* -------------------------------- votes -------------------------------- */
export const voteSubmitSchema = z.object({
  scores: z
    .array(
      z.object({
        categoryId: z.string(),
        score: z.number(),
      })
    )
    .min(1)
    .max(100),
});

/* ------------------------------ join room ------------------------------ */
export const joinRoomSchema = z.object({ code: z.string().min(6).max(8) });

/* ------------------------------ results -------------------------------- */
export const resultsQuerySchema = z.object({
  roundId: z.string().optional(),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  kind: z.enum(["summary", "categories", "raw"]).default("summary"),
});

/* -------------------------- shared API payloads ------------------------- */
export interface ApiError {
  error: string;
  details?: unknown;
  code?: string;
}
