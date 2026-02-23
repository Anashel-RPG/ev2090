import { useCallback } from "react";
import "./TouchControls.css";

/**
 * Touch Controls — floating buttons for tablet/mobile.
 * Dispatches synthetic KeyboardEvents on window so InputManager picks them up.
 *
 * Layout:
 *   Left:  single circular Thrust button (KeyW)
 *   Right: ◄ Rotate Left (KeyA) beside ► Rotate Right (KeyD)
 */

function fireKey(code: string, type: "keydown" | "keyup") {
  window.dispatchEvent(
    new KeyboardEvent(type, { code, bubbles: true, cancelable: true }),
  );
}

interface TouchBtnProps {
  code: string;
  ariaLabel: string;
  className?: string;
}

function TouchBtn({ code, ariaLabel, className }: TouchBtnProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      fireKey(code, "keydown");
    },
    [code],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      fireKey(code, "keyup");
    },
    [code],
  );

  return (
    <button
      aria-label={ariaLabel}
      className={`touch-btn${className ? ` ${className}` : ""}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
}

export function TouchControls() {
  return (
    <div className="touch-controls">
      <div className="touch-group touch-left">
        <TouchBtn code="KeyW" ariaLabel="Thrust" className="touch-thrust" />
      </div>
      <div className="touch-group touch-right">
        <TouchBtn code="KeyA" ariaLabel="Rotate left" />
        <TouchBtn code="KeyD" ariaLabel="Rotate right" />
      </div>
    </div>
  );
}
