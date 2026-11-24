import React, { useLayoutEffect, useRef, useState } from 'react';
import './SpringNav.css';

export interface SpringNavItem<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
}

export interface SpringNavProps<T extends string> {
  items: SpringNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  connected?: boolean;
}

export default function SpringNav<T extends string>({
  items,
  activeId,
  onSelect,
  connected = false,
}: SpringNavProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ y: number; h: number; ready: boolean }>({
    y: 0,
    h: 36,
    ready: false,
  });

  useLayoutEffect(() => {
    const el = btnRefs.current[activeId];
    const parent = containerRef.current;
    if (!el || !parent) return;
    setPill({
      y: el.offsetTop,
      h: el.offsetHeight,
      ready: true,
    });
  }, [activeId, items.length]);

  return (
    <div ref={containerRef} className="spring-nav">
      <div
        className={`spring-nav__glider ${connected ? 'connected' : ''}`}
        style={{
          height: pill.h,
          transform: `translateY(${pill.y}px)`,
          opacity: pill.ready ? 1 : 0,
        }}
      />
      {items.map(item => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            ref={el => {
              btnRefs.current[item.id] = el;
            }}
            type="button"
            className={`spring-nav__btn ${active ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
