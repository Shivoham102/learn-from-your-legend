#!/usr/bin/env python3
"""
Simple dental video analyzer.
Usage: python dental_gemini_video.py --video "path\to\video.mp4"
"""

import argparse
import json
import mimetypes
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

load_dotenv()

PROMPT = """
You are a dental clinical educator. You will watch a video of a dental procedure and produce a structured teaching breakdown for a pre-clinical dental student who has never performed this procedure.

Segment the video into coherent PROCEDURE STEPS (not fixed time chunks). Each segment must begin and end at a natural transition in the procedure. For each segment, narrate what is happening on screen as if walking a student through it in real time.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown, no code fences, no commentary before or after.
- Use MM:SS for all times. Timestamps are approximate; align segment boundaries to step transitions, not exact frames.
- Do NOT invent clinical facts. If you cannot clearly see what is happening, the instrument used, or the anatomy shown, set the field to "uncertain" rather than guessing. Accuracy matters more than completeness.
- Write narration in plain, encouraging tutor language a student can follow.

NARRATION LENGTH (STRICT — this controls a text-to-speech lecture, so the spoken narration MUST fit inside the segment's time window):
- The narration will be read aloud at roughly 150 words per minute. Each segment's narration must be readable WITHIN the segment's duration.
- For each segment, compute its duration in seconds (end minus start). Budget the narration word count as:
    - TARGET: about 2 words per second of segment duration.
    - FLOOR: no fewer than 1.5 words per second (do not leave a long segment with one thin sentence).
    - CEILING: never exceed 2 words per second. This is a hard limit. If you cannot say everything within the budget, say only the most important things.
- Examples: a 10s segment = 15-20 words; a 30s segment = 45-60 words; a 60s segment = 90-120 words.
- Short segments get short narration. Do NOT pad. It is correct for a 6-second segment to have a single short sentence.
- Report the actual word count of your narration in "narration_word_count" so it can be verified.

SEGMENTATION:
- Avoid micro-segments. Do not create segments shorter than ~8 seconds; merge trivial transitions into adjacent steps so each segment has room for useful narration.

Output this exact schema:
{
  "procedure": "<name of the procedure>",
  "total_duration": "MM:SS",
  "global_prerequisites": [
    { "concept": "<term/concept the student must know before starting>", "why_needed": "<one sentence>" }
  ],
  "segments": [
    {
      "id": "seg_01",
      "start": "MM:SS",
      "end": "MM:SS",
      "phase": "<e.g. diagnosis | anesthesia | caries removal | cavity prep | filling | finishing>",
      "step_name": "<short label>",
      "narration": "<narration sized to the segment duration per the NARRATION LENGTH rules: ~2 words per second of segment time, hard ceiling at 2 words/sec>",
      "narration_word_count": <integer: actual number of words in the narration field>,
      "prerequisites": [
        { "concept": "<term/concept>", "why_it_matters_here": "<one sentence>" }
      ],
      "terms": ["<terminology appearing, e.g. enamel, dentin>"],
      "instruments": ["<tools visible, or 'uncertain'>"],
      "anatomy": ["<structures visible, or 'uncertain'>"],
      "materials": ["<materials used, or 'uncertain'>"],
      "reference_image_concepts": ["<concept a reference image would help explain, e.g. healthy_tooth, stage_4_caries>"],
      "common_doubts": [
        { "question": "<a likely student question at this step>", "short_answer": "<one to two sentences>" }
      ],
      "key_moment": "MM:SS or null"
    }
  ]
}
""".strip()


class Segment(BaseModel):
    id: str
    start: str
    end: str
    phase: str
    step_name: str
    narration: str
    instruments: List[str]
    anatomy: List[str]
    materials: List[str]
    key_moment: Optional[str] = None


class DentalVideoBreakdown(BaseModel):
    procedure: str
    total_duration: str
    segments: List[Segment]


def wait_for_ready(client: genai.Client, f, timeout: int = 900):
    start = time.time()
    while time.time() - start < timeout:
        current = client.files.get(name=f.name)
        state = str(getattr(current.state, "name", current.state)).upper()
        if "ACTIVE" in state or "READY" in state or "SUCCEEDED" in state:
            return current
        if "FAILED" in state:
            raise RuntimeError(f"Gemini file processing failed: {state}")
        print(f"  Processing video... {state}")
        time.sleep(5)
    raise TimeoutError("Gemini video processing timed out.")


def main():
    parser = argparse.ArgumentParser(description="Analyze a dental procedure video with Gemini.")
    parser.add_argument("--video", required=True, help="Path to the video file.")
    parser.add_argument("--output", default=None, help="Path for the output JSON file.")
    parser.add_argument("--model", default="gemini-3.5-flash", help="Gemini model name.")
    parser.add_argument("--fps", type=float, default=2.0, help="Sampling FPS. Default: 2.0")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("ERROR: GEMINI_API_KEY not set. Add it to your .env file or environment.")

    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        sys.exit(f"ERROR: Video not found: {video_path}")

    output_path = Path(args.output) if args.output else video_path.with_suffix(".json")

    client = genai.Client(api_key=api_key)

    print(f"Uploading: {video_path}")
    uploaded = client.files.upload(file=str(video_path))
    uploaded = wait_for_ready(client, uploaded)
    print(f"Ready: {uploaded.name}")

    mime = getattr(uploaded, "mime_type", None) or mimetypes.guess_type(str(video_path))[0] or "video/mp4"

    print(f"Analyzing with {args.model}...")
    response = client.models.generate_content(
        model=args.model,
        contents=types.Content(
            parts=[
                types.Part(
                    file_data=types.FileData(file_uri=uploaded.uri, mime_type=mime),
                    video_metadata=types.VideoMetadata(fps=args.fps),
                ),
                types.Part(text=PROMPT),
            ]
        ),
        config={
            "response_mime_type": "application/json",
            "response_schema": DentalVideoBreakdown.model_json_schema(),
        },
    )

    raw_text = response.text.strip()

    try:
        result = DentalVideoBreakdown.model_validate_json(raw_text)
    except ValidationError as exc:
        raw_path = output_path.with_suffix(".raw.json")
        raw_path.write_text(raw_text, encoding="utf-8")
        print(f"Validation failed. Raw response saved to: {raw_path}")
        raise

    output_path.write_text(
        json.dumps(result.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Done. Saved to: {output_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
