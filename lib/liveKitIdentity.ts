export type BrowserLiveKitIdentity = {
  userName: string;
  sessionId: string;
  identity: string;
  roomName: string;
};

const SESSION_ID_KEY = "probeiq.livekit.sessionId";

function cleanPart(value: string | undefined, fallback: string) {
  const cleaned = (value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function createSessionId() {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getBrowserLiveKitIdentity(): BrowserLiveKitIdentity {
  const userName = cleanPart(process.env.NEXT_PUBLIC_USER_NAME, "local");
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = createSessionId();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  const cleanSessionId = cleanPart(sessionId, createSessionId());
  if (cleanSessionId !== sessionId) {
    sessionStorage.setItem(SESSION_ID_KEY, cleanSessionId);
  }

  return {
    userName,
    sessionId: cleanSessionId,
    identity: `student-${userName}-${cleanSessionId}`,
    roomName: `probeiq-${userName}-${cleanSessionId}`,
  };
}
