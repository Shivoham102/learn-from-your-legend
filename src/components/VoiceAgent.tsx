"use client";

import { useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type VoiceAgentProps = {
  videoId: string | null;
};

export function VoiceAgent({ videoId }: VoiceAgentProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Upload a clip, then ask why a play happened — by timestamp or description. Voice input is stubbed for now; type your question below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!videoId || !input.trim() || sending) return;

    const question = input.trim();
    setInput("");
    setMessages((current) => [...current, { role: "user", content: question }]);
    setSending(true);

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, message: question }),
      });

      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
      };

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.reply ?? payload.error ?? "No response.",
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "Something went wrong reaching the voice agent.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex h-full min-h-[420px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-100 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-900">Voice agent</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Ask about specific plays while the video processes.
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 ${
              message.role === "user"
                ? "ml-auto bg-emerald-600 text-white"
                : "bg-zinc-100 text-zinc-800"
            }`}
          >
            {message.content}
          </div>
        ))}
      </div>

      <form
        onSubmit={sendMessage}
        className="flex gap-2 border-t border-zinc-100 p-4"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            videoId
              ? "Why did they switch to zone at 1:58?"
              : "Upload a video to start chatting"
          }
          disabled={!videoId || sending}
          className="flex-1 rounded-full border border-zinc-200 px-4 py-3 text-sm outline-none ring-emerald-500 focus:ring-2 disabled:bg-zinc-50"
        />
        <button
          type="button"
          disabled={!videoId}
          title="Voice capture stub — wire up WebRTC or a provider later"
          className="rounded-full border border-zinc-200 px-4 py-3 text-sm text-zinc-600 disabled:cursor-not-allowed disabled:text-zinc-300"
        >
          Mic
        </button>
        <button
          type="submit"
          disabled={!videoId || sending || !input.trim()}
          className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          Send
        </button>
      </form>
    </section>
  );
}
