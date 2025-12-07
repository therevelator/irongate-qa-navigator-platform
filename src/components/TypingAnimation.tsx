import React, { useState, useEffect } from 'react';

interface TypingAnimationProps {
  className?: string;
}

const messages = [
  'CI/CD: because manually deploying is how horror stories begin.',
  'Ship with confidence, not with crossed fingers.',
  'Building confidence, one fix at a time.',
  'Turning surprises into scheduled tasks.',
  'Quality: because hope is not a test plan.',
  'Keeping outages off the weekend calendar.',
  'Making reliability boring—in the best way.',
  'Written with the wisdom of past outages.',
  'Lessons learned the hard way, applied the smart way.',
  'Because some mistakes only need to happen once.',
  'Turning noise into signals you can trust.',
  'Seeing patterns where others see problems.',
  'Finding order in the things that look unpredictable.',
  'Bringing order to the metrics chaos'
];

const TypingAnimation: React.FC<TypingAnimationProps> = ({ className = '' }) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  const currentMessage = messages[currentMessageIndex];
  const typingSpeed = 30; // ms per character
  const deletingSpeed = 15; // ms per character when deleting
  const pauseAfterTyping = 30 * 60 * 1000; // ms to pause after typing complete (30 minutes)
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
