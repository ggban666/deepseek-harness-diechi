// 蝶翅APP brand wordmark: butterfly mark + "蝶翅" letterform.
// Replaces the DeepSeek Harness wordmark (whale + deepseek-official + HARNESS
// badge) for the 蝶翅APP brand. The butterfly artwork is the project's brand
// image served from /favicon.png; text rides currentColor so it stays
// legible in both themes.
import type { IconProps } from './icons/props.ts'

/**
 * Render the 蝶翅APP brand wordmark.
 * @param props.size - height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns butterfly mark + 蝶翅 wordmark (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.35),
        height: size,
        whiteSpace: 'nowrap',
      }}
    >
      <img
        src="/favicon.png"
        alt=""
        style={{
          height: size,
          width: size,
          borderRadius: Math.round(size * 0.2),
          objectFit: 'cover',
          flex: 'none',
        }}
      />
      <span
        style={{
          fontSize: Math.round(size * 0.85),
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: 2,
          color: 'currentColor',
        }}
      >
        蝶翅
      </span>
    </span>
  )
}
