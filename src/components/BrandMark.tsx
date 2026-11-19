import React from 'react';

/**
 * The IronGate shield (logo V3: brushed-metal shield with the blue circuit brain;
 * public/brand/qe-shield-{40,80,120,240}.{webp,png}, trimmed to the shield, transparent background,
 * a few KB each; master public/brand/irongate-logo-v3.png), with its size set so it never shifts
 * the layout. Reads on light and dark backgrounds alike (metal shield with its own dark face).
 */
const RATIO = 2374 / 3476; // width / height of the trimmed shield

/** Every size (by width) so a large mark (sign-in page) stays crisp on high-density screens. */
const srcSet = (ext: string) => '/brand/qe-shield-40.EXT 27w, /brand/qe-shield-80.EXT 55w, /brand/qe-shield-120.EXT 82w, /brand/qe-shield-240.EXT 164w'.replace(/EXT/g, ext);

const BrandMark: React.FC<{ height?: number; className?: string }> = ({ height = 32, className }) => {
  const width = Math.round(height * RATIO);
  return (
    <picture className="contents">
      <source type="image/webp" srcSet={srcSet('webp')} sizes={`${width}px`} />
      <img
        src="/brand/qe-shield-40.png"
        srcSet={srcSet('png')}
        sizes={`${width}px`}
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
