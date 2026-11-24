import React from 'react';

export interface AnimatedContentProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function AnimatedContent({
  children,
  delay = 0,
  className = '',
  style,
}: AnimatedContentProps) {
  return (
    <div
      className={`rb-animated-content ${className}`.trim()}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}
