import { NextRequest, NextResponse } from "next/server";
import { generateDentalContext } from "@/lib/moss";
import { generateTutorResponse } from "@/lib/llm";

/**
 * AI Tutor endpoint
 *
 * Workflow:
 *   User Question → Moss Retrieval → Context → LLM → Structured Response
 */
export async function POST(request: NextRequest) {
  try {
    const { question } = await request.json();

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    const context = await generateDentalContext(question);
    const response = await generateTutorResponse(question, context);

    return NextResponse.json(response);
  } catch (error) {
    console.error("[/api/ask]", error);
    return NextResponse.json(
      { error: "Failed to process question" },
      { status: 500 }
    );
  }
}
