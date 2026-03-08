import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { QuestCommsState, QuestDialogueLine } from "@/types/game";
import "./ChatPanel.css";

interface ChatMessage {
  id: string;
  nickname: string;
  text: string;
  timestamp: number;
}

interface Props {
  apiUrl: string;
  nickname: string;
  questComms: QuestCommsState | null;
}

/** Merge chat messages and quest transcript, sorted by timestamp. */
function mergeMessages(
  chat: ChatMessage[],
  quest: QuestDialogueLine[],
): Array<{ id: string; type: "chat" | "quest"; data: ChatMessage | QuestDialogueLine }> {
  const merged: Array<{ id: string; type: "chat" | "quest"; data: ChatMessage | QuestDialogueLine; ts: number }> = [];

  for (const m of chat) {
    merged.push({ id: m.id, type: "chat", data: m, ts: m.timestamp });
  }
  for (const q of quest) {
    merged.push({ id: q.id, type: "quest", data: q, ts: q.timestamp });
  }

  merged.sort((a, b) => a.ts - b.ts);
  // Keep last 20 messages
  return merged.slice(-20);
}

export function ChatPanel({ apiUrl, nickname, questComms }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fresh, setFresh] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache quest transcript so NPC messages persist after quest completes
  const [cachedQuestTranscript, setCachedQuestTranscript] = useState<QuestDialogueLine[]>([]);

  // Quest visible — messages are flowing, keep COMMS at full opacity
  const questVisible = questComms !== null && questComms.phase !== "COMPLETE";

  // Narrative active — input locked, full mission styling (SIGNAL_DETECTED and beyond)
  const narrativeActive = questComms !== null &&
    questComms.phase !== "IDLE" &&
    questComms.phase !== "COMPLETE";

  // No auto-expand — user can minimize COMMS during mission

  // Keep COMMS fully visible for 10 seconds on load, then fade
  useEffect(() => {
    const timer = setTimeout(() => setFresh(false), 10000);
    return () => clearTimeout(timer);
  }, []);

  // Update cached quest transcript whenever new messages arrive
  useEffect(() => {
    if (questComms?.transcript && questComms.transcript.length > 0) {
      setCachedQuestTranscript(questComms.transcript);
    }
  }, [questComms?.transcript]);

  // Merge chat + quest messages (use cached transcript so NPC text persists)
  const mergedMessages = useMemo(
    () => mergeMessages(messages, cachedQuestTranscript),
    [messages, cachedQuestTranscript],
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mergedMessages]);

  // Load chat history on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/history`);
        if (!res.ok) {
          console.error("[COMMS] history fetch failed:", res.status, res.statusText);
          return;
        }
        const data: ChatMessage[] = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;
        setMessages((prev) => {
          const seen = new Map(prev.map((m) => [m.id, m]));
          for (const m of data) {
            if (!seen.has(m.id)) seen.set(m.id, m);
          }
          return Array.from(seen.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-7);
        });
      } catch (err) {
        console.error("[COMMS] history fetch error:", err);
      }
    })();
  }, [apiUrl]);

  // SSE connection with auto-reconnect
  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`${apiUrl}/stream`);
    esRef.current = es;

    es.onopen = () => {
      console.log("[COMMS] SSE connected");
      setConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data);
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const updated = [...prev, msg];
          return updated.slice(-7);
        });
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      console.error("[COMMS] SSE connection lost, reconnecting in 3s…");
      es.close();
      esRef.current = null;
      setConnected(false);

      reconnectTimer.current = setTimeout(() => {
        connect();
      }, 3000);
    };
  }, [apiUrl]);

  useEffect(() => {
    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connect]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    if (!connected) {
      console.warn("[COMMS] not connected — sending anyway (no SSE echo)");
    }

    setInput("");

    try {
      const res = await fetch(`${apiUrl}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, text }),
      });
      if (!res.ok) {
        console.error("[COMMS] send failed:", res.status, res.statusText);
        return;
      }

      if (!connected) {
        const data = (await res.json().catch(() => null)) as { id?: string } | null;
        const id = data?.id ?? `local-${Date.now()}`;
        setMessages((prev) => {
          if (prev.some((m) => m.id === id)) return prev;
          return [
            ...prev,
            { id, nickname, text, timestamp: Date.now() },
          ].slice(-7);
        });
      }
    } catch (err) {
      console.error("[COMMS] send error:", err);
      setMessages((prev) => [
        ...prev.slice(-6),
        {
          id: `local-${Date.now()}`,
          nickname,
          text,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [apiUrl, nickname, input, connected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === "Escape") {
      inputRef.current?.blur();
    }
  };

  return (
    <div className={`chat-panel ${minimized ? "chat-minimized" : ""} ${fresh ? "chat-fresh" : ""} ${questVisible ? "chat-quest-visible" : ""} ${narrativeActive ? "chat-mission-active" : ""}`}>
      <div className="chat-header" onClick={() => setMinimized(!minimized)}>
        <span className="chat-title">COMMS</span>
        <span
          className={`chat-status ${connected ? "chat-online" : "chat-offline"}`}
        />
        <button className="chat-toggle">{minimized ? "+" : "-"}</button>
      </div>

      {!minimized && (
        <>
          <div className="chat-messages">
            {mergedMessages.length === 0 && (
              <div className="chat-empty">No transmissions yet...</div>
            )}
            {mergedMessages.map((entry) => {
              if (entry.type === "chat") {
                const msg = entry.data as ChatMessage;
                return (
                  <div key={entry.id} className="chat-msg">
                    <span className="chat-nick">[{msg.nickname}]</span>{" "}
                    <span className="chat-text">{msg.text}</span>
                  </div>
                );
              }
              // Quest message
              const q = entry.data as QuestDialogueLine;
              return (
                <div key={entry.id} className={`chat-msg chat-quest chat-quest-${q.type}`}>
                  <span className="chat-quest-sender">[{q.sender}]</span>{" "}
                  <span className="chat-quest-text">{q.text}</span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-row">
            <span className={`chat-prompt ${narrativeActive ? "chat-prompt-mission" : ""}`}>
              {narrativeActive ? "!" : ">"}
            </span>
            {narrativeActive ? (
              <div className="chat-input chat-input-locked">
                {questComms?.objective ?? "MISSION ACTIVE"}
              </div>
            ) : (
              <input
                ref={inputRef}
                type="text"
                className="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="transmit..."
                maxLength={200}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
