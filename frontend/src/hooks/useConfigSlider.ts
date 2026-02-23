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

  return { value, handleChange, reset };
}
