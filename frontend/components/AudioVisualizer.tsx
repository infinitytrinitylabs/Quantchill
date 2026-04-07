'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface AudioVisualizerProps {
  isPlaying: boolean;
  accentColor: string;
}

export default function AudioVisualizer({
  isPlaying,
  accentColor,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (ts: number) => {
      animRef.current = requestAnimationFrame(draw);
      const elapsed = ts - timeRef.current;
      if (elapsed < 33) return; // ~30 fps cap
      timeRef.current = ts;

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const speed = isPlaying ? 1 : 0.15;
      const t = ts * 0.001 * speed;

      // Draw concentric breathing rings
      const numRings = 6;
      for (let i = 0; i < numRings; i++) {
        const frac = i / numRings;
        const baseR = 40 + frac * Math.min(cx, cy) * 0.75;
        const breathe = isPlaying
          ? Math.sin(t * 1.2 + frac * Math.PI) * 12
          : Math.sin(t * 0.5 + frac * Math.PI) * 4;
        const r = baseR + breathe;
        const alpha = isPlaying
          ? 0.06 + 0.1 * Math.abs(Math.sin(t + frac * 2))
          : 0.03 + 0.03 * Math.abs(Math.sin(t + frac * 2));

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(accentColor, alpha);
        ctx.lineWidth = isPlaying ? 1.5 : 0.8;
        ctx.stroke();
      }

      // Draw flowing wave bars at the bottom
      const numBars = 64;
      const barWidth = width / numBars;
      for (let i = 0; i < numBars; i++) {
        const normalised = i / numBars;
        const barHeight = isPlaying
          ? (Math.sin(t * 3 + normalised * 12) * 0.5 + 0.5) * height * 0.18 + 4
          : (Math.sin(t * 0.6 + normalised * 8) * 0.5 + 0.5) * height * 0.04 + 2;
        const alpha = isPlaying ? 0.45 : 0.2;
        ctx.fillStyle = hexToRgba(accentColor, alpha);
        ctx.fillRect(
          i * barWidth,
          height - barHeight,
          barWidth * 0.6,
          barHeight
        );
      }

      // Central glow orb
      const orbR = isPlaying
        ? 18 + Math.sin(t * 2) * 5
        : 12 + Math.sin(t * 0.8) * 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
      grad.addColorStop(0, hexToRgba(accentColor, isPlaying ? 0.9 : 0.4));
      grad.addColorStop(1, hexToRgba(accentColor, 0));
      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying, accentColor]);

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        aria-hidden="true"
      />
    </motion.div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
