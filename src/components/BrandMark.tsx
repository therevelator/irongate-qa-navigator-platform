import React from 'react';

/**
 * The IronGate shield (public/brand/qe-shield-{40,80,120}.png: the owner's logo cut to the shield,
 * transparent background, a few KB each), with its size set so it never shifts the layout.
 */
const RATIO = 494 / 715; // width / height of the cut shield

const BrandMark: React.FC<{ height?: number; className?: string }> = ({ height = 32, className }) => (
  <img
    src="/brand/qe-shield-40.png"
    srcSet="/brand/qe-shield-40.png 1x, /brand/qe-shield-80.png 2x, /brand/qe-shield-120.png 3x"
    width={Math.round(height * RATIO)}
    height={height}
    alt="IronGate"
    className={className}
    style={{ width: Math.round(height * RATIO), height }}
    decoding="async"
  />
);

export default BrandMark;
