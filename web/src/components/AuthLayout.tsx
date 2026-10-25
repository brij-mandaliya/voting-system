import type { ReactNode } from "react";
import { BrandLockup } from "./Brand";

/** Sign-in and account screens: one narrow column on the frame tint, the form on a white sheet. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-frame px-4 py-10 sm:justify-center">
      <main className="w-full max-w-[24rem]">
        <div className="mb-8">
          <BrandLockup />
        </div>
        {children}
        <p className="mt-6 text-[13px] leading-relaxed text-ink-500">
          Sessions use secure, HTTP-only cookies. Nobody else ever sees your password.
        </p>
      </main>
    </div>
  );
}
