import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";

export async function POST() {
  const jar = await cookies();
  const sesiId = jar.get("solemate_session")?.value;

  if (sesiId) {
    const pool = getPool();
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sesiId]);
  }

  // Hapus cookie.
  jar.delete("solemate_session");

  return NextResponse.json({ ok: true });
}
