import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { PLATFORM } from "@/lib/platform";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The document title and favicon are the platform's, for every tenant.
 *
 * These are `export const metadata`, evaluated once at build time — so they
 * could not be tenant-derived even if that were desirable, and it is not. A
 * browser tab is how somebody finds this product among thirty others; making it
 * say a different thing per workspace would mean a support call that starts
 * with working out which application is being described.
 *
 * The icon was `https://z-cdn.chatglm.cn/z-ai/static/logo.svg` — a scaffold URL
 * left over from the project template, on a third-party host this product does
 * not control. Every page load fetched the platform's own identity from
 * somebody else's server, and the day that file changes, every customer's tab
 * silently becomes something else. It is served from `public/` now.
 */
export const metadata: Metadata = {
  title: PLATFORM.product,
  description: PLATFORM.tagline,
  icons: {
    icon: PLATFORM.logo,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}