import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Every route under this layout is session-gated, so it must never be
// statically prerendered at build time (Next.js otherwise tries to,
// finds no request/session to read, and — correctly, per the guard in
// lib/session.ts — fails the build rather than baking dev-stub data into
// a static page).
export const dynamic = "force-dynamic";

// Shared shell for every authenticated route. Kept deliberately plain
// (no design system yet) — the point of Phase 0/1 is proving the data
// path works end to end, not the visual layer.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // getSession(), not requireSession() — a visitor with no session yet is
  // the ordinary case (first visit, expired cookie), not an error to
  // crash on. Auth.js's built-in /api/auth/signin page (no custom
  // pages.signIn configured in lib/auth.ts) lists the configured
  // providers — good enough until a real sign-in page is designed.
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <nav className="flex gap-6 text-sm font-medium">
          <Link href="/matters">Matters</Link>
          <Link href="/search">Search</Link>
          <Link href="/time">Time</Link>
        </nav>
        <span className="text-sm text-zinc-500">{session.email}</span>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
