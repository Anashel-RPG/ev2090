import { useState, useRef, useEffect } from "react";
import "./NicknameEditor.css";

interface Props {
  nickname: string;
  onNicknameChange: (name: string) => void;
}

export function NicknameEditor({ nickname, onNicknameChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim() || "Pilot";
    onNicknameChange(trimmed);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") {
      setDraft(nickname);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="nickname-editor">
        <span className="nickname-label">CALLSIGN</span>
        <input
          ref={inputRef}
          type="text"
          className="nickname-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          maxLength={16}
        />
      </div>
    );
  }

  return (
    <div
      className="nickname-editor"
      onClick={() => {
        setDraft(nickname);
        setEditing(true);
      }}
      title="Click to edit callsign"
    >
      <span className="nickname-label">CALLSIGN</span>
      <span className="nickname-value">{nickname}</span>
    </div>
  );
}
