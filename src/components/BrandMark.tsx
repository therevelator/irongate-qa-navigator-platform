import React from 'react';

/**
 * The IronGate shield (logo V3: brushed-metal shield with the blue circuit brain;
 * public/brand/qe-shield-{40,80,120}.{webp,png}, trimmed to the shield, transparent background,
 * a few KB each; master public/brand/irongate-logo-v3.png), with its size set so it never shifts
 * the layout. Reads on light and dark backgrounds alike (metal shield with its own dark face).
 */
const RATIO = 2374 / 3476; // width / height of the trimmed shield

const BrandMark: React.FC<{ height?: number; className?: string }> = ({ height = 32, className }) => {
  const width = Math.round(height * RATIO);
  return (
    <picture className="contents">
      <source type="image/webp" srcSet="/brand/qe-shield-40.webp 1x, /brand/qe-shield-80.webp 2x, /brand/qe-shield-120.webp 3x" />
      <img
        src="/brand/qe-shield-40.png"
        srcSet="/brand/qe-shield-40.png 1x, /brand/qe-shield-80.png 2x, /brand/qe-shield-120.png 3x"
        width={width}
        height={height}
        alt="IronGate"
        className={className}
        style={{ width, height }}
        decoding="async"
      />
    </picture>
  );
};

export default BrandMark;
