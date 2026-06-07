import { NextRequest, NextResponse } from "next/server";
import { generateDentalContext, isMossConfigured } from "@/lib/moss";
import type { MossQueryResponse } from "@/types/moss";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const question = body.question ?? body.query;

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }

    const answerContext = await generateDentalContext(question);

    const response: MossQueryResponse = {
      answerContext,
      source: isMossConfigured() ? "moss" : "local",
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[/api/moss/query]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Moss query failed",
      },
      { status: 500 }
    );
  }
}
