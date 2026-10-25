import { prisma } from "../db";
import type { Prisma } from "@prisma/client";

export const teamRepo = {
  list() {
    return prisma.team.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { members: { where: { deletedAt: null, status: "ACTIVE" } } } } },
    });
  },
  /** Lightweight lookup used by bulk import duplicate detection. */
  listNames() {
    return prisma.team.findMany({
      select: { id: true, name: true, deletedAt: true },
      orderBy: { name: "asc" },
    });
  },
  findById(id: string) {
    return prisma.team.findFirst({ where: { id, deletedAt: null } });
  },
  findByName(name: string) {
    return prisma.team.findFirst({ where: { name, deletedAt: null } });
  },
  create(data: Prisma.TeamUncheckedCreateInput) {
    return prisma.team.create({ data });
  },
  update(id: string, data: Prisma.TeamUncheckedUpdateInput) {
    return prisma.team.update({ where: { id }, data });
  },
  /** Soft delete that frees the name: "Vajra" becomes "Vajra (deleted 3f2a1c)". */
  softDelete(id: string, name: string) {
    return prisma.team.update({ where: { id }, data: { deletedAt: new Date(), name: deletedName(name, id) } });
  },
  /** Frees the name still held by a team that was deleted before names were released on delete. */
  releaseDeletedName(id: string, name: string) {
    return prisma.team.updateMany({ where: { id, deletedAt: { not: null } }, data: { name: deletedName(name, id) } });
  },
  /** Deleted teams that were never used for voting: no room links, rounds or votes. */
  async withoutHistory(ids: string[]) {
    if (ids.length === 0) return new Set<string>();
    const teams = await prisma.team.findMany({
      where: { id: { in: ids }, roomTeams: { none: {} }, voteTargets: { none: {} } },
      select: { id: true },
    });
    const rounds = await prisma.votingRound.findMany({ where: { teamId: { in: ids } }, select: { teamId: true } });
    const withRounds = new Set(rounds.map((r) => r.teamId));
    return new Set(teams.map((t) => t.id).filter((id) => !withRounds.has(id)));
  },
  countMembers(id: string) {
    return prisma.user.count({ where: { teamId: id, deletedAt: null, status: "ACTIVE" } });
  },
};

function deletedName(name: string, id: string) {
  return `${name} (deleted ${id.slice(-6)})`;
}
