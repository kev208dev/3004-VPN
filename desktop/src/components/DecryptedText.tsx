import React, { useEffect, useState } from 'react';

const CHARS = '0123456789ABCDEF.:/';

export interface DecryptedTextProps {
  text: string;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function DecryptedText({
  text,
  speed = 32,
  className = '',
  style,
}: DecryptedTextProps) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    let frame = 0;
    const total = text.length;
    if (!total) {
      setDisplay('');
      return;
    }

    const timer = window.setInterval(() => {
      frame += 1;
      const revealed = Math.floor(frame / 2);
      const next = text
        .split('')
        .map((ch, idx) => {
          if (ch === ' ' || ch === '.' || ch === ':') return ch;
          if (idx < revealed) return ch;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join('');
      setDisplay(next);
      if (revealed >= total) {
        setDisplay(text);
        window.clearInterval(timer);
      }
    }, speed);

    return () => window.clearInterval(timer);
  }, [text, speed]);

  return (
    <span className={className} style={style}>
      {display}
    </span>
  );
}
