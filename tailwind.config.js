/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#E8ECF3',
          100: '#C5CCDB',
          200: '#8A95B0',
          300: '#5A6885',
          400: '#394560',
          500: '#1A253C',
          600: '#16213A',
          700: '#111F3C',
          800: '#0D1C3B',
          900: '#091530',
          950: '#060F22',
        },
        gold: {
          50: '#FBEFD6',
          100: '#FAEDCF',
          200: '#F5DA9E',
          300: '#EFC56D',
          400: '#E4A93C',
          500: '#D49826',
          600: '#B07A1B',
          700: '#875C16',
          800: '#5E3F10',
          900: '#3A260A',
        },
        ivory: {
          50: '#FFFFFF',
          100: '#FFFFFF',
          200: '#EDEFF3',
          300: '#DDE1E8',
          400: '#C3C9D4',
          500: '#B5BDCC',
          600: '#8E97A8',
          700: '#6B7588',
          800: '#4A526A',
          900: '#2E3548',
        },
        // White surfaces and neutral hairlines (no off-white anywhere); navy & gold stay the brand.
        paper: '#FFFFFF',
        sand: '#E3E7EE',
        burgundy: {
          50: '#FBEFF0',
          100: '#F5DCDF',
          200: '#EBB9BE',
          400: '#A02E36',
          500: '#8B2530',
          600: '#6F1820',
          700: '#581018',
          800: '#420912',
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
        card: '0 1px 3px 0 rgba(13, 28, 59, 0.06), 0 1px 2px -1px rgba(13, 28, 59, 0.04)',
        'card-hover': '0 8px 24px -6px rgba(13, 28, 59, 0.12), 0 2px 4px -2px rgba(13, 28, 59, 0.04)',
        sidebar: '4px 0 24px -4px rgba(0,0,0,0.10)',
        drawer: '-8px 0 40px -8px rgba(0,0,0,0.18)',
        popover: '0 12px 40px -8px rgba(13, 28, 59, 0.18), 0 0 0 1px rgba(13, 28, 59, 0.04)',
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
