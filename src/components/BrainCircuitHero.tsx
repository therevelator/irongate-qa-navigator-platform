import React, { useState, useEffect, useRef } from 'react';

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

const BrainCircuitHero: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [slideOut, setSlideOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Typing speed & delays
  const TYPE_SPEED = 50; // ms per char
  const PAUSE_AFTER_COMPLETE = 2500; // ms before sliding

  useEffect(() => {
    if (isTyping) {
      // Type character by character
      const timer = setTimeout(() => {
        const nextChar = messages[currentIndex][displayedText.length];
        setDisplayedText(prev => prev + nextChar);
        if (displayedText.length + 1 === messages[currentIndex].length) {
          setIsTyping(false);
        }
      }, TYPE_SPEED);
      return () => clearTimeout(timer);
    } else {
      // Wait, then slide out
      const timer = setTimeout(() => {
        setSlideOut(true);
      }, PAUSE_AFTER_COMPLETE);
      return () => clearTimeout(timer);
    }
  }, [displayedText, isTyping, currentIndex]);

  // After slide-out animation finishes, reset and next message
  useEffect(() => {
    if (slideOut) {
      const timer = setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % messages.length);
        setDisplayedText('');
        setIsTyping(true);
        setSlideOut(false);
      }, 600); // match slide-out duration
      return () => clearTimeout(timer);
    }
  }, [slideOut]);

  return (
    <div className="relative px-4 sm:px-6 py-12 sm:py-16 lg:py-20 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-700">
      {/* Background circuits (subtle animated lines) */}
      <div className="absolute inset-0 opacity-10 dark:opacity-20 pointer-events-none">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="circuitGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <path
            d="M 0 20 Q 50 20 100 20 T 200 20 L 300 20 Q 400 20 500 20 T 600 20"
            stroke="url(#circuitGradient)"
            strokeWidth="1"
            fill="none"
            className="animate-pulse"
          />
          <path
            d="M 0 40 Q 80 40 160 40 T 320 40 L 480 40 Q 640 40 800 40"
            stroke="url(#circuitGradient)"
            strokeWidth="1"
            fill="none"
            className="animate-pulse"
            style={{ animationDelay: '0.5s' }}
          />
          <path
            d="M 0 60 Q 60 60 120 60 T 240 60 L 360 60 Q 480 60 600 60"
            stroke="url(#circuitGradient)"
            strokeWidth="1"
            fill="none"
            className="animate-pulse"
            style={{ animationDelay: '1s' }}
          />
        </svg>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto flex items-center gap-6">
        {/* Logo + Brain */}
        <div className="flex-shrink-0 flex items-center">
          <div className="relative">
            {/* Brain icon behind logo */}
            <svg
              className="absolute -top-2 -left-2 w-20 h-20 text-cyan-500/30 dark:text-cyan-400/30"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <img
              alt="IronGate QA Navigator"
              className="h-20 w-auto object-contain relative z-10"
              src="/irongate-logo.png"
            />
          </div>
        </div>

        {/* Messages coming from circuits */}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 dark:text-slate-100 leading-tight mb-2">
            IronGate QE Navigator
          </h1>
          <div className="relative h-8 overflow-hidden">
            <div
              ref={containerRef}
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
