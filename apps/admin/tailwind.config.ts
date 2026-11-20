import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        purple: {
          50: '#F3E8F4',
          100: '#E7D1E9',
          500: '#8B2E8E',
          600: '#6B1A6E',
          700: '#551558',
          900: '#3A0E3D',
        },
        navy: {
          50: '#EAF0FA',
          100: '#C5D4EF',
          500: '#254EA0',
          600: '#1B3870',
          700: '#152D5A',
        },
        nogent: {
          green: '#8DC63F',
          cyan: '#29B5E8',
        }
      }
    }
  },
  plugins: [],
}
export default config
