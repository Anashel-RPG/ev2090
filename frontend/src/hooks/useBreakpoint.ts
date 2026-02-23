import { useState, useEffect } from "react";

export type Breakpoint = "desktop" | "ipad" | "mobile";

function getBreakpoint(width: number): Breakpoint {
  if (width >= 1024) return "desktop";
  if (width >= 768) return "ipad";
  return "mobile";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => getBreakpoint(window.innerWidth));

  useEffect(() => {
    const onResize = () => {
      setBp(getBreakpoint(window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return bp;
}
