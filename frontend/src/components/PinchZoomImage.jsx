// Fev/2026 · Imagem com pinch-to-zoom (2 dedos) + pan (arrastar) + duplo-toque + roda do mouse.
// Usa pointer events unificados (funciona em mobile e desktop).
// Zoom entre 1x e 6x. Duplo-toque alterna 1x ⇄ 2.5x.
import React, { useRef, useState, useEffect, useCallback } from 'react';

export const PinchZoomImage = ({ src, alt = '', className = '', resetKey = null, testid = 'pinch-zoom-image' }) => {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const pointers = useRef(new Map());
  const startDist = useRef(0);
  const startScale = useRef(1);
  const startPos = useRef({ x: 0, y: 0 });
  const startCenter = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastTap = useRef(0);

  // Reset ao trocar de foto
  useEffect(() => { setScale(1); setPos({ x: 0, y: 0 }); }, [src, resetKey]);

  const clampPos = useCallback((p, s) => {
    const c = containerRef.current;
    const im = imgRef.current;
    if (!c || !im) return p;
    const rect = c.getBoundingClientRect();
    // largura extra além do container é o que pode se deslocar
    const maxX = Math.max(0, (im.clientWidth * s - rect.width) / 2);
    const maxY = Math.max(0, (im.clientHeight * s - rect.height) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  }, []);

  const applyZoom = useCallback((newScale, centerX, centerY) => {
    const s = Math.max(1, Math.min(6, newScale));
    // ao dar zoom, mantém o ponto sob o centro dos dedos "estático" tanto quanto possível
    const dx = (centerX - (containerRef.current?.getBoundingClientRect().left ?? 0)) - (containerRef.current?.clientWidth ?? 0) / 2;
    const dy = (centerY - (containerRef.current?.getBoundingClientRect().top ?? 0)) - (containerRef.current?.clientHeight ?? 0) / 2;
    const factor = s / scale;
    const nx = pos.x - dx * (factor - 1);
    const ny = pos.y - dy * (factor - 1);
    setScale(s);
    setPos(clampPos({ x: nx, y: ny }, s));
  }, [scale, pos, clampPos]);

  const onPointerDown = (e) => {
    e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      startDist.current = Math.hypot(b.x - a.x, b.y - a.y);
      startScale.current = scale;
      startCenter.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      startPos.current = { ...pos };
    } else if (pointers.current.size === 1) {
      // pan quando já está zoom
      dragging.current = scale > 1;
      startPos.current = { ...pos };
      // duplo-toque
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const rect = containerRef.current.getBoundingClientRect();
        applyZoom(scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (startDist.current > 0) {
        const newScale = Math.max(1, Math.min(6, startScale.current * (dist / startDist.current)));
        setScale(newScale);
      }
    } else if (pointers.current.size === 1 && dragging.current) {
      const p = [...pointers.current.values()][0];
      const dx = p.x - startCenter.current.x;
      const dy = p.y - startCenter.current.y;
      // se veio de um "single-tap" sem 2 dedos primeiro, define centro na primeira movimentação
      if (!startCenter.current.x) startCenter.current = { x: p.x, y: p.y };
      const rawDx = p.x - startCenter.current.x;
      const rawDy = p.y - startCenter.current.y;
      setPos(clampPos({ x: startPos.current.x + rawDx, y: startPos.current.y + rawDy }, scale));
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) startDist.current = 0;
    if (pointers.current.size === 0) { dragging.current = false; startCenter.current = { x: 0, y: 0 }; }
    // após soltar, garante que a imagem não fique fora do container
    setPos((p) => clampPos(p, scale));
  };

  // Zoom com roda do mouse (desktop)
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30) return; // evita scroll acidental
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    applyZoom(scale * factor, e.clientX, e.clientY);
  };

  return (
    <div
      ref={containerRef}
      data-testid={`${testid}-container`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      className={`relative flex items-center justify-center overflow-hidden select-none ${className}`}
      style={{ touchAction: 'none', cursor: scale > 1 ? 'grab' : 'zoom-in' }}
    >
      <img
        ref={imgRef}
        data-testid={testid}
        src={src}
        alt={alt}
        draggable={false}
        className="max-w-full max-h-[80vh] object-contain rounded-xl pointer-events-none"
        style={{
          transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: pointers.current.size === 0 ? 'transform 0.15s ease-out' : 'none',
          boxShadow: '0 0 40px rgba(224,255,0,0.15)',
        }}
      />
      {/* HUD do nível de zoom */}
      {scale > 1.02 && (
        <div
          data-testid={`${testid}-zoom-badge`}
          className="absolute top-2 right-2 px-2 py-1 rounded-full bg-black/60 border border-white/20 text-[10px] font-black text-[#E0FF00] font-mono"
        >
          {scale.toFixed(1)}x
        </div>
      )}
      {/* Botão reset quando ampliado */}
      {scale > 1.02 && (
        <button
          type="button"
          data-testid={`${testid}-reset`}
          onClick={(e) => { e.stopPropagation(); setScale(1); setPos({ x: 0, y: 0 }); }}
          className="absolute bottom-2 right-2 px-3 py-1 rounded-full bg-black/60 border border-white/20 text-[10px] font-black text-white"
        >
          Ajustar
        </button>
      )}
    </div>
  );
};
