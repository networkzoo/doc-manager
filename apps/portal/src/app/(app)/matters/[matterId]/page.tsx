import { eq, asc } from "drizzle-orm";
import { withTenant, schema } from "@law-portal/db";
import { requireSession } from "@/lib/session";
import { DownloadButton } from "./DownloadButton";

// Minimal matter detail: enough to prove docs/PLAN.md Phase 1's exit
// criteria (click a document, it downloads via the tunnel-free relay).
// Parties, ethical walls, conflicts history, versions, and upload are
// Phase 2/3 (docs/PLAN.md) and deliberately not here yet.
export default async function MatterDetailPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const session = await requireSession();

  const { matter, documents } = await withTenant(session.tenantId, session.userId, async (tx) => {
    const [matter] = await tx
      .select({
        matterNumber: schema.matters.matterNumber,
        practiceArea: schema.matters.practiceArea,
        status: schema.matters.status,
      })
      .from(schema.matters)
      .where(eq(schema.matters.id, matterId))
      .limit(1);

    const documents = matter
      ? await tx
          .select({ id: schema.documents.id, filename: schema.documents.filename })
          .from(schema.documents)
          .where(eq(schema.documents.matterId, matterId))
          .orderBy(asc(schema.documents.filename))
      : [];

    return { matter, documents };
  });

  if (!matter) {
    return <p className="text-sm text-zinc-500">Matter not found.</p>;
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">{matter.matterNumber}</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {matter.practiceArea} — {matter.status}
      </p>

      <h2 className="mb-2 text-sm font-semibold">Documents</h2>
      {documents.length === 0 ? (
        <p className="text-sm text-zinc-500">No documents yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">Filename</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-2">{doc.filename}</td>
                <td className="py-2">
                  <DownloadButton documentId={doc.id} filename={doc.filename} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
