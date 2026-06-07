"""Upload the dental knowledge documents in moss_docs/ into a single Moss index.

Reads every `moss_docs/*.json` that is a list of {id, text, metadata} documents,
namespaces the ids by file (so ids stay unique across categories), and pushes
them into one combined index. Re-runnable: upserts on subsequent runs.

Usage (from repo root or agent/):
    agent/.venv/Scripts/python.exe agent/sync_moss.py

Requires MOSS_PROJECT_ID and MOSS_PROJECT_KEY in the repo-root .env.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from moss import DocumentInfo, MossClient, MutationOptions

REPO_ROOT = Path(__file__).parent.parent
MOSS_DOCS_DIR = REPO_ROOT / "moss_docs"
INDEX_NAME = "dental_procedure"

load_dotenv(REPO_ROOT / ".env")


def load_documents() -> list[DocumentInfo]:
    docs: list[DocumentInfo] = []
    for path in sorted(MOSS_DOCS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            # e.g. the raw segments file (a dict) — covered locally by the agent
            print(f"  skip {path.name} (not a document list)")
            continue
        stem = path.stem
        for item in data:
            metadata = {k: str(v) for k, v in (item.get("metadata") or {}).items()}
            metadata.setdefault("category", stem)
            docs.append(
                DocumentInfo(
                    id=f"{stem}__{item['id']}",
                    text=item["text"],
                    metadata=metadata,
                )
            )
        print(f"  + {path.name}: {len(data)} docs")
    return docs


async def main() -> None:
    project_id = os.environ.get("MOSS_PROJECT_ID", "")
    project_key = os.environ.get("MOSS_PROJECT_KEY", "")
    if not project_id or not project_key:
        raise SystemExit("MOSS_PROJECT_ID / MOSS_PROJECT_KEY missing in .env")

    docs = load_documents()
    print(f"Loaded {len(docs)} documents — syncing into '{INDEX_NAME}'...")

    client = MossClient(project_id, project_key)
    try:
        await client.get_index(INDEX_NAME)
        await client.add_docs(INDEX_NAME, docs, MutationOptions(upsert=True))
        print(f"Updated existing index '{INDEX_NAME}'.")
    except Exception:
        await client.create_index(INDEX_NAME, docs)
        print(f"Created index '{INDEX_NAME}'.")


if __name__ == "__main__":
    asyncio.run(main())
