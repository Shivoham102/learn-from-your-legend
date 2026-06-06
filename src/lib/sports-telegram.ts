/**
 * Placeholder for sports-telegrams.dklhub integration.
 * Replace these stubs with real API calls once the hub contract is defined.
 */

export type TelegramPlayContext = {
  playId: string;
  source: "sports-telegrams.dklhub";
  summary: string;
  tags: string[];
};

export async function fetchPlayContext(
  playId: string,
): Promise<TelegramPlayContext | null> {
  const baseUrl = process.env.SPORTS_TELEGRAMS_DKLHUB_URL;
  if (!baseUrl) return null;

  // TODO: call dklhub endpoint, e.g. GET ${baseUrl}/plays/${playId}
  void playId;
  return {
    playId,
    source: "sports-telegrams.dklhub",
    summary: "Stub context from sports-telegrams.dklhub.",
    tags: ["stub"],
  };
}
