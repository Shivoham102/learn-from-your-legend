#!/usr/bin/env python3
"""
Dental video analyzer using Qwen3-VL API.
Usage: python dental_qwen_video.py --video "path\to\video.mp4"
"""

import argparse
import base64
import io
import json
import os
import sys
from pathlib import Path
from typing import List, Optional

import numpy as np
from PIL import Image
from pydantic import BaseModel, ValidationError


try:
    from decord import VideoReader, cpu
except Exception:
    VideoReader = None

try:
    import cv2
except Exception:
    cv2 = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

try:
    from openai import OpenAI
except Exception:
    OpenAI = None


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


class PrerequisiteItem(BaseModel):
    concept: str
    why_needed: str


class SegmentPrerequisite(BaseModel):
    concept: str
    why_it_matters_here: str


class CommonDoubt(BaseModel):
    question: str
    short_answer: str


class Segment(BaseModel):
    id: str
    start: str
    end: str
    phase: str
    step_name: str
    narration: str
    narration_word_count: int
    prerequisites: List[SegmentPrerequisite]
    terms: List[str]
    instruments: List[str]
    anatomy: List[str]
    materials: List[str]
    reference_image_concepts: List[str]
    common_doubts: List[CommonDoubt]
    key_moment: Optional[str] = None


class DentalVideoBreakdown(BaseModel):
    procedure: str
    total_duration: str
    global_prerequisites: List[PrerequisiteItem]
    segments: List[Segment]


def extract_frames(video_path: str, target_fps: float = 2.0, max_frames: int = 128):
    """Extract frames from a local video file uniformly, capped at max_frames."""
    if VideoReader is not None:
        return _extract_with_decord(video_path, target_fps, max_frames)
    if cv2 is not None:
        return _extract_with_cv2(video_path, target_fps, max_frames)
    raise RuntimeError(
        "No video backend available. Install decord (`pip install decord`) "
        "or opencv-python (`pip install opencv-python`)."
    )


def _extract_with_decord(video_path: str, target_fps: float, max_frames: int):
    vr = VideoReader(video_path, ctx=cpu(0))
    total_frames = len(vr)
    native_fps = float(vr.get_avg_fps())
    duration_sec = total_frames / native_fps if native_fps > 0 else 0.0

    if target_fps > 0 and duration_sec > 0:
        num_frames = int(duration_sec * target_fps)
    else:
        num_frames = total_frames

    if num_frames > max_frames:
        num_frames = max_frames
    if num_frames < 4:
        num_frames = min(4, total_frames)
    if num_frames < 1:
        num_frames = 1

    indices = np.linspace(0, total_frames - 1, num=num_frames, dtype=int)
    frames = vr.get_batch(indices).asnumpy()
    timestamps = [float(idx) / native_fps for idx in indices]
    return frames, timestamps, duration_sec


def _extract_with_cv2(video_path: str, target_fps: float, max_frames: int):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_sec = total_frames / native_fps if native_fps > 0 else 0.0

    if target_fps > 0 and duration_sec > 0:
        num_frames = int(duration_sec * target_fps)
    else:
        num_frames = total_frames

    if num_frames > max_frames:
        num_frames = max_frames
    if num_frames < 4:
        num_frames = min(4, total_frames)
    if num_frames < 1:
        num_frames = 1

    indices = set(np.linspace(0, total_frames - 1, num=num_frames, dtype=int).tolist())
    frames = []
    timestamps = []
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx in indices:
            # Convert BGR -> RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(frame_rgb)
            timestamps.append(frame_idx / native_fps)
        frame_idx += 1
    cap.release()
    return np.stack(frames, axis=0), timestamps, duration_sec


def frame_to_base64(frame: np.ndarray, quality: int = 85) -> str:
    """Convert a numpy RGB frame to a base64 JPEG data URL."""
    img = Image.fromarray(frame)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


def format_time(seconds: float) -> str:
    """Format seconds as MM:SS."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"


def build_interleaved_content(frames: np.ndarray, timestamps: List[float], prompt: str):
    """Build interleaved timestamp + image_url message content for the API."""
    content = []
    for frame, ts in zip(frames, timestamps):
        content.append({
            "type": "text",
            "text": f"<{ts:.1f} seconds>"
        })
        content.append({
            "type": "image_url",
            "image_url": {"url": frame_to_base64(frame)}
        })
    content.append({
        "type": "text",
        "text": prompt
    })
    return content


def strip_json_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def main():
    parser = argparse.ArgumentParser(
        description="Analyze a dental procedure video with Qwen3-VL API."
    )
    parser.add_argument("--video", required=True, help="Path to the video file.")
    parser.add_argument("--output", default=None, help="Path for the output JSON file.")
    parser.add_argument(
        "--model", default="qwen3-vl", help="Qwen model ID for API. Default: qwen3-vl"
    )
    parser.add_argument(
        "--fps", type=float, default=2.0, help="Target sampling FPS. Default: 2.0"
    )
    parser.add_argument(
        "--max-frames", type=int, default=128,
        help="Maximum frames to send (API cap ~512). Default: 128"
    )
    parser.add_argument(
        "--max-tokens", type=int, default=4096,
        help="Maximum output tokens. Default: 4096"
    )
    args = parser.parse_args()

    if OpenAI is None:
        sys.exit(
            "ERROR: openai package not installed. Run: pip install openai"
        )

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_HTTP_API_URL")
    if not api_key:
        sys.exit(
            "ERROR: DASHSCOPE_API_KEY not set. "
            "Add it to your .env file or environment."
        )
    if not base_url:
        base_url = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        sys.exit(f"ERROR: Video not found: {video_path}")

    output_path = Path(args.output) if args.output else video_path.with_suffix(".json")

    print(f"Extracting frames from: {video_path}")
    frames, timestamps, duration_sec = extract_frames(
        str(video_path), target_fps=args.fps, max_frames=args.max_frames
    )
    print(f"  -> {len(frames)} frames, duration {format_time(duration_sec)}")

    print(f"Analyzing with {args.model} API...")
    client = OpenAI(api_key=api_key, base_url=base_url)

    messages_content = build_interleaved_content(frames, timestamps, PROMPT)
    messages = [{"role": "user", "content": messages_content}]

    completion = client.chat.completions.create(
        model=args.model,
        messages=messages,
        max_tokens=args.max_tokens,
    )

    raw_text = completion.choices[0].message.content
    raw_text = strip_json_fences(raw_text)

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
