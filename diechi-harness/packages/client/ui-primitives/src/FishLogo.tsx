// 蝶翅APP butterfly logo: the butterfly brand mark replaces the DeepSeek
// whale. Rendered as a square crop of the brand art (the mark is served from
// /favicon.png); color rides the underlying image, class flows through for
// layout placement.
import type { IconProps } from './icons/props.ts'

/**
 * Render the 蝶翅APP butterfly logo.
 * @param props.size - width in px (default 24; height keeps a 1:1 crop).
 * @param props.className - extra class for layout placement.
 * @returns the butterfly logo (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/favicon.png"
      alt=""
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        borderRadius: Math.round(size * 0.2),
        flex: 'none',
      }}
    />
  )
}
