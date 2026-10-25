import type { User } from "@prisma/client";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: User["role"];
  status: User["status"];
  mustChangePassword: boolean;
  /** false: Google-only account, can set a first password without a current one */
  hasPassword: boolean;
  teamId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** set by handlers requiring double-submit CSRF */
      csrfCookie?: string;
    }
  }
}
