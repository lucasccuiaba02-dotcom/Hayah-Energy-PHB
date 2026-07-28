import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Horizontal scroll container with L/R arrow buttons for desktop navigation.
 * Arrows appear only when overflow exists, and disable at edges.
 * Also keyboard-accessible.
 *
 * Usage:
 * <HScroller step={320} testid="carteira-hscroll">
 *   <table>...</table>
 * </HScroller>
 */
export const HScroller = ({ children, step = 320, testid = 'hscroll', className = '' }) => {
  const ref = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update, children]);

  const scrollBy = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <div className={`relative group ${className}`}>
      <button
        data-testid={`${testid}-prev`}
        type="button"
        onClick={() => scrollBy(-1)}
        disabled={!canPrev}
        aria-label="Rolar para esquerda"
        className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/70 backdrop-blur border border-white/20 items-center justify-center text-white hover:bg-[#E0FF00] hover:text-black disabled:opacity-0 disabled:pointer-events-none transition-all shadow-lg"
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        data-testid={`${testid}-next`}
        type="button"
        onClick={() => scrollBy(1)}
        disabled={!canNext}
        aria-label="Rolar para direita"
        className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/70 backdrop-blur border border-white/20 items-center justify-center text-white hover:bg-[#E0FF00] hover:text-black disabled:opacity-0 disabled:pointer-events-none transition-all shadow-lg"
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
      >
        <ChevronRight className="w-5 h-5" />
      </button>
      <div ref={ref} className="hscroll-fancy" data-testid={`${testid}-viewport`}>
        {children}
      </div>
    </div>
  );
};
