import React from 'react';
import './ShinyText.css';

export interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  tone?: 'default' | 'green' | 'amber';
  className?: string;
}

export default function ShinyText({
  text,
  disabled = false,
  speed = 4.2,
  tone = 'default',
  className = '',
}: ShinyTextProps) {
  const toneClass = tone === 'green' ? 'shiny-green' : tone === 'amber' ? 'shiny-amber' : '';
  return (
    <span
      className={`shiny-text ${toneClass} ${disabled ? 'disabled' : ''} ${className}`.trim()}
      style={{ animationDuration: `${speed}s` }}
    >
      {text}
    </span>
  );
}
