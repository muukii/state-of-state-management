/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          dark: '#0a0a0a',
        },
        subtle: {
          DEFAULT: '#fafafa',
          dark: '#111111',
        },
        border: {
          DEFAULT: '#e5e5e5',
          dark: '#1a1a1a',
        },
      },
      typography: ({ theme }) => ({
        neutral: {
          css: {
            '--tw-prose-body': theme('colors.neutral.600'),
            '--tw-prose-headings': theme('colors.neutral.900'),
            '--tw-prose-links': theme('colors.neutral.900'),
            '--tw-prose-bold': theme('colors.neutral.700'),
            '--tw-prose-code': theme('colors.neutral.800'),
            '--tw-prose-hr': theme('colors.neutral.200'),
            '--tw-prose-th-borders': theme('colors.neutral.200'),
            '--tw-prose-td-borders': theme('colors.neutral.100'),
            '--tw-prose-invert-body': theme('colors.neutral.400'),
            '--tw-prose-invert-headings': theme('colors.neutral.100'),
            '--tw-prose-invert-links': theme('colors.neutral.100'),
            '--tw-prose-invert-bold': theme('colors.neutral.300'),
            '--tw-prose-invert-code': theme('colors.neutral.200'),
            '--tw-prose-invert-hr': theme('colors.neutral.800'),
            '--tw-prose-invert-th-borders': theme('colors.neutral.800'),
            '--tw-prose-invert-td-borders': theme('colors.neutral.800'),
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
