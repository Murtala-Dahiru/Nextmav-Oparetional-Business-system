'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Keeps the module's original controls, callbacks and active state in place. */
export function ContextualNavigation({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setEdges({
      left: element.scrollLeft > 2,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); };
  }, []);

  const move = (direction: number) => {
    const element = viewport.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * .7, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  return <div className="nm-horizontal-navigation">
    {edges.left && <button type="button" className="nm-nav-scroll" aria-label="Scroll module navigation left" onClick={() => move(-1)}><ChevronLeft size={16} /></button>}
    <div ref={viewport} className="nm-horizontal-navigation-viewport" onFocusCapture={event => {
      const target = event.target as HTMLElement;
      if (target.matches('button, [role="tab"]')) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }}>{children}</div>
    {edges.right && <button type="button" className="nm-nav-scroll" aria-label="Scroll module navigation right" onClick={() => move(1)}><ChevronRight size={16} /></button>}
  </div>;
}
