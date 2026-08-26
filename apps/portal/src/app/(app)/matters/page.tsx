import Link from "next/link";
import { withTenant, schema } from "@law-portal/db";
import { desc } from "drizzle-orm";
import { requireSession } from "@/lib/session";

// First real, DB-backed page: proves the Next.js -> Drizzle -> RLS-scoped
// Postgres path works end to end (see docs/PLAN.md Phase 2). Deliberately
// minimal — no create/edit forms yet, just enough to verify the query
// path and tenant scoping against seed data.
export default async function MattersPage() {
  const session = await requireSession();

  const matters = await withTenant(session.tenantId, session.userId, async (tx) => {
    return tx
      .select({
        id: schema.matters.id,
        matterNumber: schema.matters.matterNumber,
        practiceArea: schema.matters.practiceArea,
        status: schema.matters.status,
        limitationDate: schema.matters.limitationDate,
      })
      .from(schema.matters)
      .orderBy(desc(schema.matters.openedAt))
      .limit(50);
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Matters</h1>
      {matters.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No matters yet. Seed the database (see packages/db) to see rows here.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">Matter #</th>
              <th className="py-2">Practice area</th>
              <th className="py-2">Status</th>
              <th className="py-2">Limitation date</th>
            </tr>
          </thead>
          <tbody>
            {matters.map((m) => (
              <tr key={m.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-2">
                  <Link href={`/matters/${m.id}`} className="underline">
                    {m.matterNumber}
                  </Link>
                </td>
                <td className="py-2">{m.practiceArea}</td>
                <td className="py-2">{m.status}</td>
                <td className="py-2">
                  {m.limitationDate ? new Date(m.limitationDate).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
