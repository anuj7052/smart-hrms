/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: {
      'xs': '480px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Mobile app palette: palette.primary = '#1A3C6E'
        primary: {
          DEFAULT: '#006591',          // new SmartHRMS / Sphere brand primary (MD3)
          50:  '#EEF3FB',
          100: '#D5E3F5',
          200: '#ACC7EB',
          300: '#82ABE0',
          400: '#598FD5',
          500: '#2E5A9E',
          600: '#1A3C6E',   // palette.primary — main brand navy (legacy pages)
          700: '#0F2747',   // palette.primaryDark
          800: '#0A1B33',
          900: '#060F1E',
        },

        // ── MD3 Sphere design system tokens ────────────────────────
        'primary-container':         '#0ea5e9',
        'primary-fixed':             '#c9e6ff',
        'primary-fixed-dim':         '#89ceff',
        'on-primary':                '#ffffff',
        'on-primary-container':      '#003751',
        'on-primary-fixed':          '#001e2f',
        'on-primary-fixed-variant':  '#004c6e',

        secondary:                   '#9d4300',
        'secondary-container':       '#fd761a',
        'secondary-fixed':           '#ffdbca',
        'secondary-fixed-dim':       '#ffb690',
        'on-secondary':              '#ffffff',
        'on-secondary-container':    '#5c2400',
        'on-secondary-fixed':        '#341100',
        'on-secondary-fixed-variant':'#783200',

        tertiary:                    '#006399',
        'tertiary-container':        '#58a1dc',
        'tertiary-fixed':            '#cde5ff',
        'tertiary-fixed-dim':        '#94ccff',
        'on-tertiary':               '#ffffff',
        'on-tertiary-container':     '#003656',
        'on-tertiary-fixed':         '#001d32',
        'on-tertiary-fixed-variant': '#004b74',

        surface:                     '#f6faff',
        'surface-bright':            '#f6faff',
        'surface-dim':               '#d6dae0',
        'surface-variant':           '#dee3e9',
        'surface-tint':              '#006591',
        'surface-container-lowest':  '#ffffff',
        'surface-container-low':     '#f0f4fa',
        'surface-container':         '#eaeef4',
        'surface-container-high':    '#e4e8ee',
        'surface-container-highest': '#dee3e9',
        'on-surface':                '#171c20',
        'on-surface-variant':        '#3e4850',
        'inverse-surface':           '#2c3135',
        'inverse-on-surface':        '#edf1f7',
        'inverse-primary':           '#89ceff',
        background:                  '#f6faff',
        'on-background':             '#171c20',

        outline:                     '#6e7881',
        'outline-variant':           '#bec8d2',

        'error-container':           '#ffdad6',
        'on-error':                  '#ffffff',
        'on-error-container':        '#93000a',


        // palette.present = '#16A34A'
        success: {
          50:  '#F0FDF4',
          100: '#DCFCE7',
          400: '#4ADE80',
          500: '#16A34A',
          600: '#15803D',
        },
        // palette.absent = '#DC2626'
        danger: {
          50:  '#FEF2F2',
          100: '#FEE2E2',
          400: '#F87171',
          500: '#DC2626',
          600: '#B91C1C',
        },
        // palette.accent = '#F59E0B'
        accent: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
        },
        error: '#ba1a1a',
      },
      fontFamily: {
        sans: ['"Manrope"', '"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Sora"', '"Manrope"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'headline-xl':        ['clamp(32px, 2.5vw + 1rem, 40px)', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg':        ['clamp(26px, 2vw + 0.75rem, 32px)', { lineHeight: '1.25', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg-mobile': ['clamp(24px, 1.8vw + 0.6rem, 28px)', { lineHeight: '1.28', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md':        ['clamp(20px, 1.5vw + 0.5rem, 24px)', { lineHeight: '1.33', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-sm':        ['clamp(17px, 1.2vw + 0.4rem, 20px)', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg':            ['clamp(15px, 0.9vw + 0.4rem, 16px)', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
        'body-md':            ['clamp(13px, 0.8vw + 0.3rem, 14px)', { lineHeight: '1.43', letterSpacing: '0', fontWeight: '400' }],
        'body-sm':            ['clamp(12px, 0.7vw + 0.25rem, 13px)', { lineHeight: '1.38', letterSpacing: '0', fontWeight: '400' }],
        'label-md':           ['clamp(11px, 0.6vw + 0.2rem, 12px)', { lineHeight: '1.33', letterSpacing: '0.02em', fontWeight: '600' }],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        'soft-low':    '0 2px 4px -1px rgba(0, 101, 145, 0.04), 0 1px 2px -1px rgba(0, 101, 145, 0.02)',
        'soft-medium': '0 12px 24px -4px rgba(0, 101, 145, 0.08), 0 4px 8px -2px rgba(0, 101, 145, 0.04)',
        'soft-high':   '0 32px 64px -16px rgba(0, 101, 145, 0.12)',
        // premium depth
        'glow-primary':     '0 10px 30px -6px rgba(0, 101, 145, 0.45), 0 4px 12px -4px rgba(0, 101, 145, 0.25), inset 0 1px 0 rgba(255,255,255,0.18)',
        'glow-primary-lg':  '0 20px 50px -10px rgba(0, 101, 145, 0.55), 0 8px 20px -6px rgba(15, 39, 71, 0.35), inset 0 1px 0 rgba(255,255,255,0.22)',
        'inset-highlight':  'inset 0 1px 0 rgba(255,255,255,0.7), inset 0 0 0 1px rgba(15,39,71,0.04)',
        'premium-card':     '0 1px 1px rgba(15,39,71,0.04), 0 8px 24px -8px rgba(15,39,71,0.10), 0 24px 48px -16px rgba(15,39,71,0.10)',
      },
      backgroundImage: {
        'hero-gradient':  'linear-gradient(135deg, #1A3C6E 0%, #0F2747 100%)',
        'brand-gradient': 'linear-gradient(160deg, #006591 0%, #004c6e 100%)',
        // premium
        'cosmic-hero':    'radial-gradient(ellipse 80% 60% at 20% 0%, #1e6fa3 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 100% 100%, #0a2f4f 0%, transparent 55%), linear-gradient(135deg, #00263d 0%, #06365a 45%, #0a4471 100%)',
        'cta-primary':    'linear-gradient(180deg, #0a7bb0 0%, #006591 55%, #004c6e 100%)',
        'cta-primary-hover': 'linear-gradient(180deg, #0d8cc4 0%, #0072a3 55%, #00567c 100%)',
        'noise':          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E\")",
      },
      animation: {
        'fade-in':       'fadeIn 0.2s ease-in-out',
        'slide-in':      'slideIn 0.2s ease-out',
        'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.16,1,0.3,1)',
        'skeleton':   'skeleton 1.5s ease-in-out infinite',
        'pulse-ring': 'pulseRing 1.5s ease-out infinite',
        // premium
        'rise':         'rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'aurora':       'aurora 18s ease-in-out infinite',
        'aurora-slow':  'aurora 28s ease-in-out infinite reverse',
        'float-slow':   'float 9s ease-in-out infinite',
        'shimmer':      'shimmer 3.5s linear infinite',
        'spin-slow':    'spin 28s linear infinite',
      },
      keyframes: {
        fadeIn:    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideIn:      { '0%': { transform: 'translateY(-8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideInRight: { '0%': { transform: 'translateX(100%)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        skeleton:  { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        pulseRing: { '0%': { transform: 'scale(1)', opacity: '0.8' }, '100%': { transform: 'scale(1.5)', opacity: '0' } },
        rise:      { '0%': { transform: 'translateY(14px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        aurora:    {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)',   opacity: '0.55' },
          '50%':      { transform: 'translate3d(4%, -6%, 0) scale(1.15)', opacity: '0.85' },
        },
        float:     {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        shimmer:   {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
