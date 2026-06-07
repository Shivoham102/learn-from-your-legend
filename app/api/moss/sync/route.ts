import { NextResponse } from "next/server";
import { isMossConfigured, MOSS_INDEXES } from "@/lib/moss";
import { syncMossIndexDocuments } from "@/lib/mossClient";
import { getAllMossIndexDocuments } from "@/lib/mossSync";

export async function POST() {
  if (!isMossConfigured()) {
    return NextResponse.json(
      {
        error:
          "Moss not configured. Set MOSS_PROJECT_ID and MOSS_API_KEY in .env.local",
      },
      { status: 503 }
    );
  }

  try {
    const indexDocs = getAllMossIndexDocuments();
    const results: Record<string, { action: string; documentCount: number }> =
      {};

    for (const [indexName, docs] of Object.entries(indexDocs)) {
      const result = await syncMossIndexDocuments(
        indexName as (typeof MOSS_INDEXES)[keyof typeof MOSS_INDEXES],
        docs
      );
      results[indexName] = {
        action: result.action,
        documentCount: docs.length,
      };
    }

    return NextResponse.json({
      success: true,
      indexes: results,
      message:
        "Synced dental_terminology, tooth_condition_images, and procedure_moments indexes",
    });
  } catch (error) {
    console.error("[/api/moss/sync]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Moss indexes",
      },
      { status: 500 }
    );
  }
}
