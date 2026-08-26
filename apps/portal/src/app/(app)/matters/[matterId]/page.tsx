// Placeholder — matter detail (parties, documents, ethical walls,
// conflicts history) lands in Phase 2/3 (docs/PLAN.md).
export default async function MatterDetailPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Matter {matterId}</h1>
      <p className="text-sm text-zinc-500">Not yet implemented — see docs/PLAN.md Phase 2/3.</p>
    </div>
  );
}
