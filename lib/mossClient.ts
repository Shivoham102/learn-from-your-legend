import type { DocumentInfo } from "@moss-dev/moss";
import { MossClient } from "@moss-dev/moss";
import type { MossIndexName } from "@/types/moss";

/**
 * Moss credentials — set in .env.local:
 *   MOSS_PROJECT_ID=your_project_id
 *   MOSS_API_KEY=your_project_key
 *
 * TODO: Replace local fallback with production indexes once credentials are set.
 * Legacy alias MOSS_PROJECT_KEY is also supported.
 */
export function getMossCredentials() {
  return {
    projectId: process.env.MOSS_PROJECT_ID ?? "",
    projectKey:
      process.env.MOSS_API_KEY ??
      process.env.MOSS_PROJECT_KEY ??
      "",
  };
}

export function isMossConfigured(): boolean {
  const { projectId, projectKey } = getMossCredentials();
  return Boolean(projectId && projectKey);
}

let mossClient: MossClient | null = null;
const loadedIndexes = new Map<string, Promise<void>>();

export function initializeMossClient(): MossClient {
  const { projectId, projectKey } = getMossCredentials();
  if (!projectId || !projectKey) {
    throw new Error(
      "Moss credentials missing. Set MOSS_PROJECT_ID and MOSS_API_KEY in .env.local"
    );
  }

  if (!mossClient) {
    mossClient = new MossClient(projectId, projectKey);
  }

  return mossClient;
}

async function ensureIndexLoaded(indexName: MossIndexName): Promise<void> {
  const client = initializeMossClient();

  if (!loadedIndexes.has(indexName)) {
    const loadPromise = client
      .loadIndex(indexName)
      .then(() => undefined)
      .catch((error) => {
        loadedIndexes.delete(indexName);
        console.warn(
          `[Moss] loadIndex("${indexName}") failed — using cloud fallback:`,
          error
        );
      });
    loadedIndexes.set(indexName, loadPromise);
  }

  await loadedIndexes.get(indexName);
}

export async function queryMossIndex(
  indexName: MossIndexName,
  query: string,
  topK = 5,
  alpha = 0.6
) {
  const client = initializeMossClient();
  await ensureIndexLoaded(indexName);
  return client.query(indexName, query, { topK, alpha });
}

export async function syncMossIndexDocuments(
  indexName: MossIndexName,
  docs: DocumentInfo[]
) {
  const client = initializeMossClient();

  try {
    await client.getIndex(indexName);
    const result = await client.addDocs(indexName, docs, { upsert: true });
    loadedIndexes.delete(indexName);
    await ensureIndexLoaded(indexName);
    return { action: "updated" as const, result };
  } catch {
    const result = await client.createIndex(indexName, docs, {
      modelId: "moss-minilm",
    });
    loadedIndexes.delete(indexName);
    await ensureIndexLoaded(indexName);
    return { action: "created" as const, result };
  }
}

export async function getMossIndexesStatus() {
  if (!isMossConfigured()) {
    return { configured: false as const };
  }

  const client = initializeMossClient();
  const indexes = await client.listIndexes();

  return {
    configured: true as const,
    indexes: indexes.map((idx) => ({
      name: idx.name,
      docCount: idx.docCount,
      status: idx.status,
    })),
  };
}
