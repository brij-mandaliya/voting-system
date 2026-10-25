import { teamRepo } from "../repositories/team.repo";
import { audit } from "../repositories/audit.repo";
import { conflict, notFound } from "../utils/errors";
import {sanitizeText } from "../utils/sanitize";
import { plainify } from "../utils/plainify";
import { Prisma } from "@prisma/client";

export const teamService = {
  list() {
    return teamRepo.list();
  },

  async create(input: Prisma.TeamUncheckedCreateInput, actorId: string, ip?: string) {
    const name = sanitizeText(input.name);
    if (await teamRepo.findByName(name)) throw conflict("A team with this name already exists");
    const team = await teamRepo.create({ ...input, name }).catch((e) => {
      // a team deleted before names were freed on delete can still hold it
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw conflict("A deleted team still uses this name. Re-import it, or pick another name");
      }
      throw e;
    });
    audit({ actorId, action: "team.create", entityType: "team", entityId: team.id, after: { name }, ip });
    return team;
  },

  async update(id: string, patch: Prisma.TeamUncheckedUpdateInput, actorId: string, ip?: string) {
    const team = await teamRepo.findById(id);
    if (!team) throw notFound("Team not found");
    if (patch.name && typeof patch.name === "string") {
      const name = sanitizeText(patch.name);
      const existing = await teamRepo.findByName(name);
      if (existing && existing.id !== id) throw conflict("A team with this name already exists");
      patch.name = name;
    }
    const updated = await teamRepo.update(id, patch as Prisma.TeamUncheckedUpdateInput);
    audit({
      actorId,
      action: "team.update",
      entityType: "team",
      entityId: id,
      before: { name: team.name },
      after: plainify(patch),
      ip,
    });
    return updated;
  },

  async softDelete(id: string, actorId: string, ip?: string) {
    const team = await teamRepo.findById(id);
    if (!team) throw notFound("Team not found");
    await teamRepo.softDelete(id, team.name);
    audit({ actorId, action: "team.soft_delete", entityType: "team", entityId: id, before: { name: team.name }, ip });
    return { deleted: true };
  },
};
