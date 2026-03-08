import { useState, useCallback } from "react";

interface ConfigSliderOptions {
  initial: number;
  onChange: (value: number) => void;
}

export function useConfigSlider({ initial, onChange }: ConfigSliderOptions) {
  const [value, setValue] = useState(initial);

  const handleChange = useCallback((newValue: number) => {
    setValue(newValue);
    onChange(newValue);
  }, [onChange]);

  const reset = useCallback((defaultValue: number) => {
    setValue(defaultValue);
    onChange(defaultValue);
  }, [onChange]);

  /** Update slider display without pushing to engine (for sync from mouse changes) */
  const syncFromEngine = useCallback((engineValue: number) => {
    setValue((prev) => {
      // Only update if meaningfully different (avoid re-render churn)
      return Math.abs(prev - engineValue) > 0.001 ? engineValue : prev;
    });
  }, []);

  return { value, handleChange, reset, syncFromEngine };
}
