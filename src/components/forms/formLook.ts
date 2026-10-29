import type { FormTheme } from '@/lib/form-builder-types';

/** Black or white, whichever reads better on this colour. */
export function readableOn(color: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#ffffff';
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0b1220' : '#ffffff';
}

/** The form's Design settings as the CSS variables form-look.css draws with. */
export function themeVars(theme: FormTheme): React.CSSProperties {
  const fs = theme.fieldStyle;
  return {
    ['--sf-primary' as string]: theme.colors.primary,
    ['--sf-accent' as string]: theme.colors.secondary || theme.colors.primary,
    ['--sf-accent-text' as string]: `color-mix(in srgb, ${theme.colors.secondary || theme.colors.primary} 70%, ${theme.colors.heading})`,
    ['--sf-on-primary' as string]: readableOn(theme.colors.primary),
    ['--sf-heading' as string]: theme.colors.heading,
    ['--sf-body' as string]: theme.colors.bodyText,
    ['--sf-muted' as string]: theme.colors.mutedText,
    ['--sf-surface' as string]: theme.colors.surfaceBackground,
    ['--sf-error' as string]: theme.colors.error,
    ['--sf-field-bg' as string]: fs.background,
    ['--sf-field-bg-focus' as string]: fs.background,
    ['--sf-field-border' as string]: fs.border,
    ['--sf-focus' as string]: fs.focusBorder,
    ['--sf-placeholder' as string]: fs.placeholderColor,
    ['--sf-label-active' as string]: `color-mix(in srgb, ${fs.focusBorder} 55%, ${fs.labelColor})`,
    ['--sf-progress' as string]: theme.progress.color || theme.colors.primary,
    ['--sf-progress-h' as string]: `${Math.max(theme.progress.height, 4)}px`,
    ['--sf-btn' as string]: theme.buttonStyle.background,
  };
}
