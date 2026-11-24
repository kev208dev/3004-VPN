import React, { useEffect, useRef, useState } from 'react';

export interface CountUpProps {
  to: number;
  duration?: number;
  suffix?: string;
  className?: string;
}

export default function CountUp({
  to,
  duration = 520,
  suffix = '',
  className = '',
}: CountUpProps) {
  const [val, setVal] = useState(to);
  const fromRef = useRef(to);

  useEffect(() => {
    const startVal = fromRef.current;
    if (startVal === to) {
      setVal(to);
      return;
    }
    const startTime = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(startVal + (to - startVal) * eased);
      setVal(next);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);

  return (
    <span className={className}>
      {val}
      {suffix}
    </span>
  );
}
