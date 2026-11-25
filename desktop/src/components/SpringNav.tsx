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
  const [pill, setPill] = useState<{ x: number; w: number; ready: boolean }>({
    x: 0,
    w: 68,
    ready: false,
  });

  useLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current[activeId];
      if (!el) return;
      setPill({
        x: el.offsetLeft,
        w: el.offsetWidth,
        ready: true,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [activeId, items.length]);

  return (
    <nav ref={containerRef} className="spring-nav" aria-label="주 메뉴">
      <div
        className={`spring-nav__glider ${connected ? 'connected' : ''}`}
        style={{
          width: pill.w,
          transform: `translateX(${pill.x}px)`,
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
    </nav>
  );
}
