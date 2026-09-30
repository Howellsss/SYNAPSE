import type { FormTheme, FormLayoutPreset } from './form-builder-types';

// ============================================================
// THEME PRESETS — starting points only, don't destroy form content
// ============================================================

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  preview: { bg: string; surface: string; accent: string; text: string };
  apply: (current: FormTheme) => FormTheme;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'clean',
    name: 'Clean',
    description: 'Light, airy, modern',
    preview: { bg: '#ffffff', surface: '#ffffff', accent: '#0a1628', text: '#334155' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#ffffff', surfaceBackground: '#ffffff', primary: '#0a1628', heading: '#0a1628', bodyText: '#334155', border: '#e2e8f0', buttonBg: '#0a1628', buttonText: '#ffffff' },
      background: { ...c.background, type: 'solid', color: '#ffffff' },
      typography: { ...c.typography, primaryFont: 'Inter, system-ui, sans-serif', headingFont: 'Inter, system-ui, sans-serif' },
    }),
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'Corporate, polished',
    preview: { bg: '#f8fafc', surface: '#ffffff', accent: '#1e40af', text: '#1e293b' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#f8fafc', surfaceBackground: '#ffffff', primary: '#1e40af', heading: '#1e293b', bodyText: '#475569', border: '#cbd5e1', buttonBg: '#1e40af', buttonText: '#ffffff' },
      background: { ...c.background, type: 'solid', color: '#f8fafc' },
      layout: { ...c.layout, containerShadow: 'subtle', containerRadius: 'medium' },
    }),
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Simple, restrained',
    preview: { bg: '#fafafa', surface: '#ffffff', accent: '#171717', text: '#525252' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#fafafa', surfaceBackground: '#ffffff', primary: '#171717', heading: '#171717', bodyText: '#525252', border: '#e5e5e5', buttonBg: '#171717', buttonText: '#ffffff' },
      background: { ...c.background, type: 'solid', color: '#fafafa' },
      layout: { ...c.layout, containerShadow: 'none', containerRadius: 'small' },
      typography: { ...c.typography, headingWeight: '600' },
    }),
  },
  {
    id: 'elegant',
    name: 'Elegant',
    description: 'Refined, sophisticated',
    preview: { bg: '#fdfcfa', surface: '#ffffff', accent: '#9d6b3b', text: '#44403c' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#fdfcfa', surfaceBackground: '#ffffff', primary: '#9d6b3b', heading: '#44403c', bodyText: '#57534e', border: '#e7e5e4', buttonBg: '#9d6b3b', buttonText: '#ffffff' },
      background: { ...c.background, type: 'solid', color: '#fdfcfa' },
      typography: { ...c.typography, primaryFont: 'Georgia, serif', headingFont: 'Georgia, serif', headingWeight: '700' },
      layout: { ...c.layout, containerRadius: 'large', containerShadow: 'subtle' },
    }),
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Strong, impactful',
    preview: { bg: '#ffffff', surface: '#ffffff', accent: '#dc2626', text: '#0f172a' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#ffffff', surfaceBackground: '#ffffff', primary: '#dc2626', heading: '#0f172a', bodyText: '#334155', border: '#fecaca', buttonBg: '#dc2626', buttonText: '#ffffff' },
      typography: { ...c.typography, headingWeight: '800', headingSize: '28px' },
      layout: { ...c.layout, containerRadius: 'small' },
    }),
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Dark mode aesthetic',
    preview: { bg: '#0f172a', surface: '#1e293b', accent: '#c8a96a', text: '#e2e8f0' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#0f172a', surfaceBackground: '#1e293b', primary: '#c8a96a', heading: '#f1f5f9', bodyText: '#cbd5e1', mutedText: '#64748b', border: '#334155', inputBackground: '#0f172a', inputText: '#e2e8f0', buttonBg: '#c8a96a', buttonText: '#0f172a' },
      background: { ...c.background, type: 'solid', color: '#0f172a' },
      fieldStyle: { ...c.fieldStyle, background: '#0f172a', textColor: '#e2e8f0', border: '#334155', focusBorder: '#c8a96a', placeholderColor: '#475569', labelColor: '#cbd5e1' },
    }),
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Bright, soft, friendly',
    preview: { bg: '#f0f9ff', surface: '#ffffff', accent: '#0284c7', text: '#0c4a6e' },
    apply: (c) => mergeTheme(c, {
      colors: { ...c.colors, pageBackground: '#f0f9ff', surfaceBackground: '#ffffff', primary: '#0284c7', heading: '#0c4a6e', bodyText: '#075985', border: '#bae6fd', buttonBg: '#0284c7', buttonText: '#ffffff' },
      background: { ...c.background, type: 'solid', color: '#f0f9ff' },
      layout: { ...c.layout, containerRadius: 'large', containerShadow: 'medium' },
    }),
  },
];

// ============================================================
// LAYOUT PRESETS
// ============================================================

export interface LayoutPreset {
  id: FormLayoutPreset;
  name: string;
  description: string;
  icon: string;
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'plain', name: 'Plain', description: 'Simple full-width form', icon: 'AlignLeft' },
  { id: 'card', name: 'Card', description: 'Centered card with shadow', icon: 'CreditCard' },
  { id: 'split', name: 'Split', description: 'Image panel + form side-by-side', icon: 'Columns2' },
  { id: 'centered', name: 'Centered', description: 'Vertically and horizontally centered', icon: 'AlignCenterVertical' },
  { id: 'full_width', name: 'Full Width', description: 'Edge-to-edge, no max width constraint', icon: 'Maximize' },
];

// ============================================================
// HELPER — merge theme partials
// ============================================================

function mergeTheme(current: FormTheme, overrides: Partial<FormTheme>): FormTheme {
  return {
    ...current,
    ...overrides,
    colors: { ...current.colors, ...overrides.colors },
    typography: { ...current.typography, ...overrides.typography },
    layout: { ...current.layout, ...overrides.layout },
    fieldStyle: { ...current.fieldStyle, ...overrides.fieldStyle },
    buttonStyle: { ...current.buttonStyle, ...overrides.buttonStyle },
    background: { ...current.background, ...overrides.background },
    split: { ...current.split, ...overrides.split },
    branding: { ...current.branding, ...overrides.branding },
    progress: { ...current.progress, ...overrides.progress },
  };
}
