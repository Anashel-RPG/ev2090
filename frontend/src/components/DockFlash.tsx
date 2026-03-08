/** Dock flash — brief screen flash effect triggered on station docking. */
import { useEffect, useState } from "react";
import "./DockFlash.css";

interface Props {
  trigger: number; // increment to re-fire
}

export function DockFlash({ trigger }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (trigger === 0) return;
    setActive(true);
    const timer = setTimeout(() => setActive(false), 700);
    return () => clearTimeout(timer);
  }, [trigger]);

  if (!active) return null;

  return <div className="dock-flash" />;
}
