import { NextResponse } from "next/server";
import { rawSql } from "@law-portal/db";

// Unauthenticated by design — used by deploy tooling and the connector
// fleet dashboard (Phase 6) to confirm the portal can reach Postgres.
// Deliberately does not touch tenant-scoped tables (no withTenant call),
// so it needs no session and can never leak RLS-protected data.
export async function GET() {
  try {
    await rawSql`select 1`;
    return NextResponse.json({ status: "ok", db: "reachable" });
  } catch (err) {
    return NextResponse.json(
      { status: "error", db: "unreachable", message: (err as Error).message },
      { status: 503 },
    );
  }
}
