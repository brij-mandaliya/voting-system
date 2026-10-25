import { Router } from "express";
import multer from "multer";
import { teamService } from "../services/team.service";
import { teamImportService } from "../services/teamImport.service";
import { requireAuth, requirePermission } from "../middleware/auth";
import { teamCreateSchema, teamImportOptionsSchema } from "@voting/shared";
import { wrap, parseBody } from "./helpers";
import { badRequest } from "../utils/errors";
import { env } from "../config";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.IMPORT_MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/\.csv$/i.test(file.originalname)) {
      return cb(badRequest("Only CSV files are accepted for team import"));
    }
    cb(null, true);
  },
});

const r = Router();

r.use(requireAuth);
r.use(requirePermission("teams:read"));

r.get("/", wrap(async (_req, res) => {
  const teams = await teamService.list();
  res.json({ teams });
}));

/* --------------------------- bulk team import --------------------------- */

r.post("/import/preview", requirePermission("teams:write"), upload.single("file"), wrap(async (req, res) => {
  if (!req.file) throw badRequest("No file uploaded");
  const options = parseBody(teamImportOptionsSchema, req.body ?? {});
  res.json(await teamImportService.previewImport(req.file.buffer, req.file.originalname, options.roomId, options.newRoomName));
}));

r.post("/import/commit", requirePermission("teams:write"), upload.single("file"), wrap(async (req, res) => {
  if (!req.file) throw badRequest("No file uploaded");
  const options = parseBody(teamImportOptionsSchema, req.body ?? {});
  res.json(
    await teamImportService.commitImport(
      req.file.buffer,
      req.file.originalname,
      { roomId: options.roomId, allOrNothing: options.allOrNothing, newRoomName: options.newRoomName },
      req.user!.id,
      req.ip ?? ""
    )
  );
}));

r.get("/import/template", requirePermission("teams:write"), wrap(async (_req, res) => {
  const template = teamImportService.buildTemplate();
  res.attachment(template.filename).type(template.contentType).send(template.body);
}));

r.post("/", requirePermission("teams:write"), wrap(async (req, res) => {
  const input = parseBody(teamCreateSchema, req.body);
  const team = await teamService.create(input, req.user!.id, req.ip ?? "");
  res.status(201).json({ team });
}));

r.patch("/:id", requirePermission("teams:write"), wrap(async (req, res) => {
  const patch = parseBody(teamCreateSchema.partial(), req.body);
  const team = await teamService.update(req.params.id, patch, req.user!.id, req.ip ?? "");
  res.json({ team });
}));

r.delete("/:id", requirePermission("teams:write"), wrap(async (req, res) => {
  res.json(await teamService.softDelete(req.params.id, req.user!.id, req.ip ?? ""));
}));

export default r;
