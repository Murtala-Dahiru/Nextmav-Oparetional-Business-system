import { Plus_Jakarta_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';

/**
 * The public surface's typefaces, defined once.
 *
 * Two layouts need them — the marketing group and the auth shell, which sits
 * outside that group — and `next/font` deduplicates by module, so declaring
 * them here means one set of preloaded files rather than two. Declaring the
 * same family in two files produces two independent font objects and two sets
 * of `<link rel="preload">`.
 */
const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const instrument = Instrument_Serif({
  variable: '--font-instrument',
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

/** Apply alongside `nm-public`; `public-fonts.css` maps these onto the tokens. */
export const publicFontVars = `${jakarta.variable} ${instrument.variable} ${jetbrains.variable}`;
