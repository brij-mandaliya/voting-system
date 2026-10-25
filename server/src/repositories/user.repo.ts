import { prisma } from "../db";
import type { Prisma } from "@prisma/client";

export const userRepo = {
  findById(id: string) {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },
  /** Login only: the one lookup that reads the password hash. */
  findByIdentifier(identifier: string) {
    const ident = identifier.trim().toLowerCase();
    return prisma.user.findFirst({
      where: { deletedAt: null, OR: [{ email: ident }, { username: ident }] },
      omit: { passwordHash: false },
    });
  },
  /** Password change only. */
  findByIdWithPassword(id: string) {
    return prisma.user.findFirst({ where: { id, deletedAt: null }, omit: { passwordHash: false } });
  },
  findByUsername(username: string) {
    return prisma.user.findFirst({ where: { username, deletedAt: null } });
  },
  findByEmail(email: string) {
    return prisma.user.findFirst({ where: { email, deletedAt: null } });
  },
  /**
   * Bulk lookup for imports. Deleted accounts are included so their reserved
   * username/email can be reported before a create fails on the unique index.
   */
  findManyByIdentities(usernames: string[], emails: string[]) {
    if (usernames.length === 0 && emails.length === 0) return Promise.resolve([]);
    return prisma.user.findMany({
      where: {
        OR: [
          ...(usernames.length ? [{ username: { in: usernames, mode: "insensitive" as const } }] : []),
          ...(emails.length ? [{ email: { in: emails, mode: "insensitive" as const } }] : []),
        ],
      },
      include: { team: { select: { id: true, name: true } } },
    });
  },
  list() {
    return prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      include: { team: { select: { id: true, name: true } } },
    });
  },
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({
      data,
      include: { team: { select: { id: true, name: true } } },
    });
  },
  createMany(users: Prisma.UserUncheckedCreateInput[]) {
    return prisma.user.createMany({ data: users });
  },
  update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return prisma.user.update({
      where: { id },
      data,
      include: { team: { select: { id: true, name: true } } },
    });
  },
  /** Compare-and-set: only replaces the hash if it is still `expected` (a concurrent change wins). */
  /** Compare-and-set so two concurrent first-password requests can't both win. */
  setFirstPassword(id: string, passwordHash: string) {
    return prisma.user.updateMany({ where: { id, hasPassword: false }, data: { passwordHash, hasPassword: true } });
  },
  replacePasswordHashIf(id: string, expected: string, passwordHash: string) {
    return prisma.user.updateMany({ where: { id, passwordHash: expected }, data: { passwordHash } });
  },
  softDelete(id: string) {
    return prisma.user.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
  },
  countByTeam(teamId: string) {
    return prisma.user.count({ where: { teamId, deletedAt: null, status: "ACTIVE" } });
  },
};
