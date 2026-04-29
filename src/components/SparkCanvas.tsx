"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  twinkle: number;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

const COLORS = ["#ff6b35", "#ffd60a", "#ff8c5a"];

function createParticle(canvasWidth: number, canvasHeight: number): Particle {
  const maxLife = 150 + Math.random() * 200;
  const angle = (Math.random() - 0.5) * 0.8; // slight horizontal drift
  return {
    x: Math.random() * canvasWidth,
    y: canvasHeight + Math.random() * 40,
    vx: Math.sin(angle) * (0.3 + Math.random() * 0.8),
    vy: -(0.8 + Math.random() * 1.6),
    size: 1 + Math.random() * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    alpha: 0,
    life: 0,
    maxLife,
    twinkle: Math.random() * Math.PI * 2,
    trail: [],
  };
}

export default function SparkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Initialize 60 particles
    particlesRef.current = Array.from({ length: 60 }, () =>
      createParticle(canvas.width, canvas.height)
    );

    // Stagger initial positions so they appear spread out
    particlesRef.current.forEach((p) => {
      p.y = Math.random() * canvas.height;
      p.life = Math.random() * p.maxLife * 0.7;
    });

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particlesRef.current.forEach((p, i) => {
        p.life++;
        p.x += p.vx + Math.sin(p.life * 0.04 + i) * 0.25;
        p.y += p.vy;
        p.twinkle += 0.06;

        const progress = p.life / p.maxLife;

        // Fade in → full → fade out
        if (progress < 0.15) {
          p.alpha = progress / 0.15;
        } else if (progress < 0.65) {
          p.alpha = 1;
        } else {
          p.alpha = (1 - progress) / 0.35;
        }

        // Twinkle
        const twinkleAlpha = p.alpha * (0.5 + 0.5 * Math.sin(p.twinkle));

        // Store trail position
        p.trail.push({ x: p.x, y: p.y, alpha: twinkleAlpha });
        if (p.trail.length > 8) p.trail.shift();

        // Draw tail
        if (p.trail.length > 1) {
          for (let t = 0; t < p.trail.length - 1; t++) {
            const tp = p.trail[t];
            const trailProgress = t / p.trail.length;
            const trailAlpha = tp.alpha * trailProgress * 0.4;
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, p.size * 0.3 * trailProgress, 0, Math.PI * 2);
            ctx.fillStyle = p.color + Math.floor(trailAlpha * 255).toString(16).padStart(2, "0");
            ctx.fill();
          }
        }

        // Draw glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
        gradient.addColorStop(
          0,
          p.color + Math.floor(twinkleAlpha * 255).toString(16).padStart(2, "0")
        );
        gradient.addColorStop(1, p.color + "00");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw core
        ctx.globalAlpha = twinkleAlpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Reset particle
        if (p.life >= p.maxLife || p.y < -30) {
          particlesRef.current[i] = createParticle(canvas.width, canvas.height);
        }
      });

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="sparks"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        opacity: 0.6,
      }}
    />
  );
}
