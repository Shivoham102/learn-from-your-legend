export function isLiveKitConfigured(): boolean {
  const apiKey = process.env.LIVEKIT_API_KEY ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? "";
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";
  return Boolean(apiKey && apiSecret && url);
}

export function getLiveKitConfig() {
  return {
    apiKey: process.env.LIVEKIT_API_KEY ?? "",
    apiSecret: process.env.LIVEKIT_API_SECRET ?? "",
    url: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "",
  };
}
