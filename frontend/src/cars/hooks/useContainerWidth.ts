// Measures an element's width so React-owned SVG charts can render at true
// pixel size (crisp text, no preserveAspectRatio stretching). Falls back to
// a sensible default where ResizeObserver is missing (jsdom).

import { useEffect, useRef, useState } from "react";

export function useContainerWidth<T extends HTMLElement>(fallback = 800) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
