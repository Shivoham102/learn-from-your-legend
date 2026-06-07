import { NextResponse } from "next/server";
import { isMossConfigured, MOSS_INDEXES } from "@/lib/moss";
import { getMossIndexesStatus } from "@/lib/mossClient";

export async function GET() {
  if (!isMossConfigured()) {
    return NextResponse.json({
      configured: false,
      source: "local",
      expectedIndexes: Object.values(MOSS_INDEXES),
      message:
        "Set MOSS_PROJECT_ID and MOSS_API_KEY in .env.local, then POST /api/moss/sync",
    });
  }

  try {
    const status = await getMossIndexesStatus();
    return NextResponse.json({
      ...status,
      source: "moss",
      expectedIndexes: Object.values(MOSS_INDEXES),
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        source: "moss",
        error:
          error instanceof Error ? error.message : "Failed to reach Moss Cloud",
      },
      { status: 502 }
    );
  }
}
