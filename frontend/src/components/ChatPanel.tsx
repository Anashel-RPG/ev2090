import { useState, useRef, useEffect, useCallback } from "react";
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
}

export function ChatPanel({ apiUrl, nickname }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fresh, setFresh] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep COMMS fully visible for 10 seconds on load, then fade
  useEffect(() => {
    const timer = setTimeout(() => setFresh(false), 10000);
    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load chat history on mount (fast initial paint before SSE connects)
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
        // Merge with any messages already delivered by SSE — don't replace
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
          // Deduplicate by id
          if (prev.some((m) => m.id === msg.id)) return prev;
          const updated = [...prev, msg];
          return updated.slice(-7);
        });
      } catch {
        // Ignore parse errors (e.g. ping comments)
      }
    };

    es.onerror = () => {
      console.error("[COMMS] SSE connection lost, reconnecting in 3s…");
      es.close();
      esRef.current = null;
      setConnected(false);

      // Auto-reconnect after 3 seconds
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

      // If SSE isn't connected, we won't get an echo back in real-time.
      // Add a local echo using the server-generated id so we dedupe later.
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
      // Offline — show locally
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
    <div className={`chat-panel ${minimized ? "chat-minimized" : ""} ${fresh ? "chat-fresh" : ""}`}>
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
            {messages.length === 0 && (
              <div className="chat-empty">No transmissions yet...</div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className="chat-msg">
                <span className="chat-nick">[{msg.nickname}]</span>{" "}
                <span className="chat-text">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-row">
            <span className="chat-prompt">&gt;</span>
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
          </div>
        </>
      )}
    </div>
  );
}
