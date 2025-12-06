import React, { useState, useEffect, useRef, useCallback } from 'react';

const messages = [
  'CI/CD: because manually deploying is how horror stories begin.',
  'Ship with confidence, not with crossed fingers.',
  'Turning chaos into predictable, measurable reliability.',
  'Driving software performance with uncompromising quality discipline.',
  'Quality without exception. Reliability without compromise.',
  'Operational certainty through engineered, repeatable precision.',
  'Because mission-critical software requires non-optional excellence.',
  'Delivering confidence at scale through disciplined engineering practices.',
  'From scattered technical signals to clear, measurable business outcomes.',
  'From disconnected logs and metrics to unified, revenue-aligned intelligence.',
  'Turning random metrics into insights you can actually explain in meetings.',
  'Transforming uncertainty into confidence—one defect at a time'
];

// Line animation helpers
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

function random(min?: number | number[], max?: number): number {
  if (arguments.length === 0) return Math.random();
  if (Array.isArray(min)) return min[Math.floor(Math.random() * min.length)];
  if (typeof min === 'undefined') min = 1;
  if (typeof max === 'undefined') {
    max = min || 1;
    min = 0;
  }
  return min + Math.random() * (max - min);
}

interface LinePoint {
  x: number;
  y: number;
  isAnchor: boolean;
}

class Line {
  x: number;
  y: number;
  path: LinePoint[];
  pathLength: number;
  angle: number;
  speed: number;
  target: { x: number; y: number };
  thickness: number;
  maxLength: number;
  hasShadow: boolean;
  decay: number;
  alpha: number;
  logoX: number;
  logoY: number;

  constructor(x: number, y: number, logoX: number, logoY: number) {
    this.x = x;
    this.y = y;
    this.logoX = logoX;
    this.logoY = logoY;
    this.path = [];
    this.pathLength = 0;
    this.speed = random(2, 5);
    this.thickness = Math.round(random(0.5, 2.5));
    this.maxLength = Math.round(random(200, 500));
    this.hasShadow = this.thickness > 1.5;
    this.decay = random(0.01, 0.04);
    this.alpha = 1;

    // Initial angle - pick the best 90° angle toward logo
    const dx = logoX - x;
    const dy = logoY - y;
    // Choose horizontal or vertical based on which gets us closer
    if (Math.abs(dx) > Math.abs(dy)) {
      this.angle = dx > 0 ? 0 : Math.PI; // right or left
    } else {
      this.angle = dy > 0 ? HALF_PI : -HALF_PI; // down or up
    }
    this.target = { x: x + Math.cos(this.angle) * 50, y: y + Math.sin(this.angle) * 50 };
  }

  step(): void {
    // Check if we've reached the logo - start fading
    const dxLogo = this.logoX - this.x;
    const dyLogo = this.logoY - this.y;
    const distToLogo = Math.sqrt(dxLogo * dxLogo + dyLogo * dyLogo);
    
    // If close to logo, start rapid fade
    if (distToLogo < 50) {
      this.alpha -= 0.08;
      return;
    }

    if (this.pathLength >= this.maxLength) {
      this.alpha -= this.decay;
      return;
    }

    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;

    let isAnchor = false;
    const target = this.target;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < this.speed) {
      isAnchor = true;
      this.x = target.x;
      this.y = target.y;
      this.steer();
    }

    this.path.push({ x: this.x, y: this.y, isAnchor });
    this.pathLength++;
  }

  draw(ctx: CanvasRenderingContext2D, gradient: CanvasGradient): void {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.lineWidth = this.thickness;
    ctx.strokeStyle = gradient;
    ctx.fillStyle = '#F7FAFB';

    ctx.beginPath();

    if (this.hasShadow) {
      ctx.shadowOffsetX = 5;
      ctx.shadowOffsetY = 10;
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(0,0,0,0.06)';
    }

    this.path.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    ctx.stroke();

    // Draw starting node
    if (this.path.length > 0) {
      ctx.beginPath();
      ctx.arc(this.path[0].x, this.path[0].y, 3, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  steer(): void {
    // Only use 90° angles: 0 (right), π/2 (down), π (left), -π/2 (up)
    const dxLogo = this.logoX - this.x;
    const dyLogo = this.logoY - this.y;
    const distToLogo = Math.sqrt(dxLogo * dxLogo + dyLogo * dyLogo);

    // Build list of valid 90° angles, heavily biased toward logo
    const possibleAngles: number[] = [];
    
    // The closer to logo, the more we bias toward it
    const bias = distToLogo < 150 ? 8 : 5;
    
    // Add angles that move toward logo (higher priority)
    if (dxLogo > 10) { for (let i = 0; i < bias; i++) possibleAngles.push(0); } // right
    if (dxLogo < -10) { for (let i = 0; i < bias; i++) possibleAngles.push(Math.PI); } // left
    if (dyLogo > 10) { for (let i = 0; i < bias; i++) possibleAngles.push(HALF_PI); } // down
    if (dyLogo < -10) { for (let i = 0; i < bias; i++) possibleAngles.push(-HALF_PI); } // up
    
    // Add perpendicular options for variety (less weight)
    possibleAngles.push(0, HALF_PI, Math.PI, -HALF_PI);

    const angle = random(possibleAngles);
    const distance = random(25, 80);

    this.path = this.path.filter((point) => point.isAnchor);
    this.target.x = this.x + Math.cos(angle) * distance;
    this.target.y = this.y + Math.sin(angle) * distance;
    this.angle = angle;
  }
}

const BrainCircuitHero: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [slideOut, setSlideOut] = useState(false);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const linesRef = useRef<Line[]>([]);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);

  const TYPE_SPEED = 50;
  const PAUSE_AFTER_COMPLETE = 2500;

  // Typing effect
  useEffect(() => {
    if (isTyping) {
      const timer = setTimeout(() => {
        const nextChar = messages[currentIndex][displayedText.length];
        setDisplayedText((prev) => prev + nextChar);
        if (displayedText.length + 1 === messages[currentIndex].length) {
          setIsTyping(false);
        }
      }, TYPE_SPEED);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setSlideOut(true);
      }, PAUSE_AFTER_COMPLETE);
      return () => clearTimeout(timer);
    }
  }, [displayedText, isTyping, currentIndex]);

  useEffect(() => {
    if (slideOut) {
      const timer = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % messages.length);
        setDisplayedText('');
        setIsTyping(true);
        setSlideOut(false);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [slideOut]);

  // Canvas animation
  const getLogoCenter = useCallback(() => {
    if (logoRef.current && canvasRef.current) {
      const logoRect = logoRef.current.getBoundingClientRect();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      return {
        x: logoRect.left - canvasRect.left + logoRect.width / 2,
        y: logoRect.top - canvasRect.top + logoRect.height / 2,
      };
    }
    return { x: 120, y: 100 };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = window.devicePixelRatio || 1;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(scale, scale);
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const width = parent.clientWidth;
      const height = parent.clientHeight;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sc = window.devicePixelRatio || 1;
      ctx.scale(sc, sc);

      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = 'round';

      const gradient = ctx.createLinearGradient(width * 0.25, 0, width * 0.75, 0);
      gradient.addColorStop(0, '#71C5E8');
      gradient.addColorStop(1, '#C2D832');

      // Filter out faded lines and step remaining
      linesRef.current = linesRef.current.filter((line) => {
        line.step();
        return line.alpha > 0.01;
      });

      // Draw all lines
      linesRef.current.forEach((line) => {
        line.draw(ctx, gradient);
      });

      // Spawn new lines from edges, converging toward logo
      // Spawn every 4 frames, and spawn 2 lines at once for more density
      if (frameRef.current % 4 === 0) {
        const logoCenter = getLogoCenter();
        
        // Spawn 2 lines per interval
        for (let i = 0; i < 2; i++) {
          // Spawn from random edge
          const edge = Math.floor(random(0, 4));
          let x: number, y: number;
          switch (edge) {
            case 0: // top
              x = random(0, width);
              y = 0;
              break;
            case 1: // right
              x = width;
              y = random(0, height);
              break;
            case 2: // bottom
              x = random(0, width);
              y = height;
              break;
            default: // left
              x = 0;
              y = random(0, height);
          }
          linesRef.current.push(new Line(x, y, logoCenter.x, logoCenter.y));
        }
      }

      frameRef.current++;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [getLogoCenter]);

  return (
    <div className="relative px-4 sm:px-6 py-12 sm:py-16 lg:py-20 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-700">
      {/* Canvas background with converging lines */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none opacity-40 dark:opacity-50"
      />

      <div className="relative z-10 max-w-7xl mx-auto flex items-center gap-6">
        {/* Logo - bigger */}
        <div className="flex-shrink-0 flex items-center">
          <img
            ref={logoRef}
            alt="IronGate QA Navigator"
            className="h-28 sm:h-32 lg:h-36 w-auto object-contain relative z-10 drop-shadow-lg"
            src="/irongate-logo.png"
          />
        </div>

        {/* Messages */}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 dark:text-slate-100 leading-tight mb-2">
            IronGate QE Navigator
          </h1>
          <div className="relative h-8 overflow-hidden">
            <div
              ref={textContainerRef}
              className={`absolute left-0 top-0 whitespace-nowrap text-xs sm:text-sm md:text-base text-gray-600 dark:text-gray-300 font-mono transition-transform duration-500 ease-in-out ${
                slideOut ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
              }`}
            >
              {displayedText}
              <span className="animate-pulse">|</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrainCircuitHero;
