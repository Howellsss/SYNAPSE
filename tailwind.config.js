/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Graphite & Indigo (Apple-style). Token names are kept from the original palette so every
      // page picks the new look up at once: navy = ink & graphite greys, gold = the indigo accent,
      // ivory = light greys, burgundy = the red for leave/delete.
      colors: {
        navy: {
          50: '#F2F2F5',
          100: '#E5E5EA',
          200: '#D1D1D6',
          300: '#AEAEB2',
          400: '#8E8E93',
          500: '#636366',
          600: '#48484A',
          700: '#2C2C2E',
          800: '#1D1D1F',
          900: '#111113',
          950: '#0B0B0D',
        },
        gold: {
          50: '#F0F1FE',
          100: '#E2E5FD',
          200: '#C7CCFB',
          300: '#A3AAF7',
          400: '#4350E6',
          500: '#3742CC',
          600: '#2F37B0',
          700: '#2A31A0',
          800: '#1F2577',
          900: '#151A52',
        },
        ivory: {
          50: '#F7F7F9',
          100: '#F2F2F5',
          200: '#E8E8ED',
          300: '#D2D2D7',
          400: '#AEAEB2',
          500: '#8E8E93',
          600: '#6E6E73',
          700: '#515154',
          800: '#3A3A3C',
          900: '#1D1D1F',
        },
        burgundy: {
          50: '#FFF1F0',
          100: '#FFE1DE',
          200: '#FFC2BC',
          400: '#E5352B',
          500: '#D70015',
          600: '#B8000F',
          700: '#990010',
          800: '#7A000D',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Geist', '"Helvetica Neue"', 'system-ui', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'Geist', '"Helvetica Neue"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px',
        '3xl': '24px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        'card-hover': '0 6px 20px -6px rgba(0, 0, 0, 0.12)',
        sidebar: '4px 0 24px -4px rgba(0,0,0,0.10)',
        drawer: '-8px 0 40px -8px rgba(0,0,0,0.18)',
        popover: '0 12px 40px -8px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'page-in': 'pageIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-up': 'slideUp 0.25s ease-out',
        'slide-right': 'slideRight 0.25s ease-out',
        'scale-in': 'scaleIn 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'toast-in': 'toastIn 0.3s cubic-bezier(0.21, 1.02, 0.73, 1)',
      },
      keyframes: {
        pageIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideRight: {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        toastIn: {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
