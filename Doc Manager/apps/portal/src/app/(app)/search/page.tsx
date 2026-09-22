// Placeholder — full-text search lands in Phase 4 (docs/PLAN.md), behind
// the SearchIndex interface backed initially by Postgres FTS
// (documents.search_vector, see packages/db/src/schema/documents.ts).
export default function SearchPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Search</h1>
      <p className="text-sm text-zinc-500">Not yet implemented — see docs/PLAN.md Phase 4.</p>
    </div>
  );
}
