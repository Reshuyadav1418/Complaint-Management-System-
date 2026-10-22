/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
      },
      fontSize: {
        // A compact scale for a dense working tool.
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.4rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
      },
      colors: {
        page: '#F4F5F7',
        surface: '#FFFFFF',
        line: '#DCDFE4',
        'line-strong': '#C3C8D0',
        ink: { DEFAULT: '#1F2328', muted: '#5B6470', faint: '#8A929C' },
        brand: { DEFAULT: '#1D5BB8', hover: '#174A97', soft: '#E8F0FB', ring: '#9DBCE9' },
        ok: { DEFAULT: '#1E7A46', soft: '#E6F4EC' },
        warn: { DEFAULT: '#9A5B00', soft: '#FDF3E1' },
        bad: { DEFAULT: '#B3261E', soft: '#FBEAE9' },
      },
      boxShadow: {
        panel: '0 1px 2px rgba(31, 35, 40, 0.06)',
        overlay: '0 8px 24px rgba(31, 35, 40, 0.16)',
      },
    },
  },
  plugins: [],
};
