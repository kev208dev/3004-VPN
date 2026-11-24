import React from 'react';
import './StarBorder.css';

export interface StarBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  color?: string;
  speed?: string;
  innerClassName?: string;
  innerStyle?: React.CSSProperties;
}

export default function StarBorder({
  className = '',
  innerClassName = '',
  innerStyle,
  color = '#ad6dff',
  speed = '5s',
  children,
  ...rest
}: StarBorderProps) {
  return (
    <div className={`star-border-container ${className}`.trim()} {...rest}>
      <div
        className="star-border-gradient-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 12%)`,
          animationDuration: speed,
        }}
      />
      <div
        className="star-border-gradient-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 12%)`,
          animationDuration: speed,
        }}
      />
      <div className={`star-border-inner ${innerClassName}`.trim()} style={innerStyle}>
        {children}
      </div>
    </div>
  );
}
