/** Community board — player-submitted notes at planet stations (backed by BoardRoom Durable Object). */
import { useState, useEffect, useRef, useCallback } from "react";
import "./CommunityBoard.css";

interface BoardNote {
  id: string;
  nickname: string;
  text: string;
  planet: string;
  timestamp: number;
}

interface Props {
  planet: string;
  nickname: string;
  apiUrl: string;
}

const MAX_WORDS = 10;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function CommunityBoard({ planet, nickname, apiUrl }: Props) {
  const [notes, setNotes] = useState<BoardNote[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const wordCount = countWords(input);
  const overLimit = wordCount > MAX_WORDS;

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiUrl}/notes?planet=${encodeURIComponent(planet)}&limit=5`,
      );
      if (!res.ok) return;
      const data: BoardNote[] = await res.json();
      if (Array.isArray(data)) {
        setNotes(data);
      }
    } catch (err) {
      console.error("[BOARD] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, planet]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handlePost = useCallback(async () => {
    const text = input.trim();
    if (!text || posting || overLimit) return;

    setPosting(true);
    setInput("");

    try {
      const res = await fetch(`${apiUrl}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, text, planet }),
      });
      if (res.ok) {
        await fetchNotes();
      }
    } catch (err) {
      console.error("[BOARD] post error:", err);
    } finally {
      setPosting(false);
    }
  }, [apiUrl, nickname, input, planet, posting, fetchNotes, overLimit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlePost();
    }
    if (e.key === "Escape") {
      inputRef.current?.blur();
    }
  };

  const formatTime = (ts: number) => {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div className="board">
      <div className="board-header">
        <span className="board-icon">&#x2759;</span>
        COMMUNITY BOARD — {planet.toUpperCase()}
      </div>

      <div className="board-notes">
        {loading && (
          <div className="board-empty">Loading transmissions...</div>
        )}
        {!loading && notes.length === 0 && (
          <div className="board-empty">
            No notes yet. Be the first to leave a mark.
          </div>
        )}
        {notes.map((note) => (
          <div key={note.id} className="board-note">
            <div className="board-note-header">
              <span className="board-note-author">{note.nickname}</span>
              <span className="board-note-time">
                {formatTime(note.timestamp)}
              </span>
            </div>
            <div className="board-note-text">{note.text}</div>
          </div>
        ))}
      </div>

      <div className="board-input-row">
        <span className="board-prompt">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          className="board-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="leave a note (10 words max)..."
          maxLength={280}
          disabled={posting}
        />
        <span className={`board-word-count ${overLimit ? "board-word-count-over" : ""}`}>
          {wordCount}/{MAX_WORDS}
        </span>
        <button
          className="board-post-btn"
          onClick={handlePost}
          disabled={!input.trim() || posting || overLimit}
        >
          POST
        </button>
      </div>
    </div>
  );
}
