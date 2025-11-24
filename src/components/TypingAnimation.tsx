import React, { useState, useEffect } from 'react';

interface TypingAnimationProps {
  className?: string;
}

const messages = [
  'Monitor, analyze, and optimize your quality assurance processes with real-time insights and comprehensive metrics.',
  'if (!QualityGate.allChecksPassed(build)) {\n    throw new ReleaseBlockedException("Quality criteria not met.");\n}',
  'Deployment deploy = pipeline.run(build);\nassert deploy.status() == Status.STABLE : "Unstable release rejected.";',
  'if (!metrics.healthScore().gte(0.95)) {\n    throw new Error("Health check failed — deployment cancelled.");\n}',
  'IronGate — We break your software so your customers don\'t have to',
  'If it can fail, we will find it. If it can\'t fail… we\'ll try harder.',
  'CI/CD: because manually deploying is how horror stories begin.',
  'IronGate - Ship with confidence, not with crossed fingers.',
  'IronGate — turning chaos into predictable, measurable reliability.',
  'IronGate - Driving software performance with uncompromising quality discipline.',
  'IronGate - Quality without exception. Reliability without compromise.',
  'Operational certainty through engineered, repeatable precision.',
  'Because mission-critical software requires non-optional excellence.',
  'Delivering confidence at scale through disciplined engineering practices.',
  'From scattered technical signals to clear, measurable business outcomes.',
  'From disconnected logs and metrics to unified, revenue-aligned intelligence.',
  'Turning random metrics into insights you can actually explain in meetings.',
  'Transforming uncertainty into confidence—one defect at a time'
];

const TypingAnimation: React.FC<TypingAnimationProps> = ({ className = '' }) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  const currentMessage = messages[currentMessageIndex];
  const typingSpeed = 30; // ms per character
  const deletingSpeed = 15; // ms per character when deleting
  const pauseAfterTyping = 3000; // ms to pause after typing complete
  const pauseAfterDeleting = 500; // ms to pause after deleting complete

  // Cursor blink effect
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530);

    return () => clearInterval(cursorInterval);
  }, []);

  // Typing/Deleting effect
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && displayedText === currentMessage) {
      // Finished typing, pause then start deleting
      timeout = setTimeout(() => {
        setIsDeleting(true);
      }, pauseAfterTyping);
    } else if (isDeleting && displayedText === '') {
      // Finished deleting, move to next message
      timeout = setTimeout(() => {
        setIsDeleting(false);
        setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
      }, pauseAfterDeleting);
    } else if (isDeleting) {
      // Deleting characters
      timeout = setTimeout(() => {
        setDisplayedText(currentMessage.substring(0, displayedText.length - 1));
      }, deletingSpeed);
    } else {
      // Typing characters
      timeout = setTimeout(() => {
        setDisplayedText(currentMessage.substring(0, displayedText.length + 1));
      }, typingSpeed);
    }

    return () => clearTimeout(timeout);
  }, [displayedText, isDeleting, currentMessage]);

  // Check if current message is code (contains newlines or code patterns)
  const isCodeMessage = currentMessage.includes('\n') || 
                        currentMessage.includes('if (') || 
                        currentMessage.includes('throw ') ||
                        currentMessage.includes('assert ');

  return (
    <div className={`${className} min-h-[2.5rem] sm:min-h-[3rem] flex items-start py-1`}>
      {isCodeMessage ? (
        <pre className="font-mono text-[11px] sm:text-xs md:text-sm text-green-600 dark:text-green-400 whitespace-pre-wrap leading-relaxed">
          {displayedText}
          <span className={`${showCursor ? 'opacity-100' : 'opacity-0'} transition-opacity`}>▊</span>
        </pre>
      ) : (
        <p className="text-xs sm:text-sm md:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
          {displayedText}
          <span className={`${showCursor ? 'opacity-100' : 'opacity-0'} transition-opacity`}>▊</span>
        </p>
      )}
    </div>
  );
};

export default TypingAnimation;
