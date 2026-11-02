import { useEffect, useRef } from "react";

// Animated "spider net" background: drifting points that link up with thin lines when they come
// close, and reach toward the mouse pointer. Draws on a canvas that fills its positioned parent.
// Pauses while the tab is hidden; renders a single still frame when the user prefers reduced motion.
export function NetworkBackground({ className = "", density = 14000, linkDistance = 140, pointerDistance = 190 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: -9999, y: -9999 };
    let width = 0, height = 0, dpr = 1, nodes = [], frame = 0;

    const seed = () => {
      const count = Math.min(120, Math.max(28, Math.round((width * height) / density)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1.2 + Math.random() * 1.6,
      }));
    };

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduceMotion) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      // links between nearby points
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < linkDistance) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.22 * (1 - dist / linkDistance)})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        // links to the pointer
        const pd = Math.hypot(a.x - pointer.x, a.y - pointer.y);
        if (pd < pointerDistance) {
          ctx.strokeStyle = `rgba(125, 211, 252, ${0.55 * (1 - pd / pointerDistance)})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke();
        }
      }
      // points
      for (const n of nodes) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
    };

    const step = () => {
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
        // gentle pull toward the pointer so the web "reaches" for it
        const dx = pointer.x - n.x, dy = pointer.y - n.y;
        const d = Math.hypot(dx, dy);
        if (d < pointerDistance && d > 1) { n.x += (dx / d) * 0.25; n.y += (dy / d) * 0.25; }
      }
      draw();
      frame = requestAnimationFrame(step);
    };

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left; pointer.y = e.clientY - rect.top;
    };
    const onLeave = () => { pointer.x = -9999; pointer.y = -9999; };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reduceMotion) frame = requestAnimationFrame(step);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    resize();
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    if (!reduceMotion) frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [density, linkDistance, pointerDistance]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`absolute inset-0 pointer-events-none ${className}`} data-testid="network-background" />;
}
