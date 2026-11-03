import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';

// Configure Outfit font
export const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  // Fallback fonts as per user request
  fallback: ['system-ui', 'arial'],
  display: 'swap',
});

// Configure Plus Jakarta Sans font
export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  fallback: ['system-ui', 'arial'],
  display: 'swap',
});

