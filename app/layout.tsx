import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RootLayoutClient } from "./layout-client";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://shopify-omni-checkout.vercel.app'),
  title: {
    default: 'Omni Checkout',
    template: '%s | Omni Checkout',
  },
  description: 'Secure App Proxy checkout and Draft Order routing for Shopify stores.',
  authors: [{ name: 'Omni Checkout' }],
  creator: 'Omni Checkout',
  publisher: 'Omni Checkout',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    title: 'Omni Checkout',
    description: 'Secure App Proxy checkout and Draft Order routing for Shopify stores.',
    siteName: 'Omni Checkout',
  },
  twitter: {
    card: 'summary',
    title: 'Omni Checkout',
    description: 'Secure App Proxy checkout and Draft Order routing for Shopify stores.',
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Inline critical CSS to eliminate render-blocking requests */}
        <style dangerouslySetInnerHTML={{__html: `
          .heroSection { max-width: 1200px; margin: 0 auto; padding: 4rem 1rem; width: 100%; }
          .heroContent { text-align: center; }
          .heroTitle { font-size: 3rem; font-weight: 700; margin-bottom: 1rem; color: #1a1a1a; line-height: 1.2; letter-spacing: -0.02em; }
          .heroSubtitle { font-size: 1.25rem; color: #666; margin-bottom: 2rem; font-weight: 400; line-height: 1.6; }
          .heroButtons { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-top: 2rem; }
          .button { display: inline-flex; align-items: center; justify-content: center; padding: 0.875rem 2.5rem; border-radius: 0.375rem; font-weight: 600; text-decoration: none; transition: all 0.2s; border: 2px solid transparent; cursor: pointer; font-size: 1rem; }
          .buttonPrimary { background-color: #2563eb; color: white; }
          .buttonPrimary:hover { background-color: #1d4ed8; transform: translateY(-2px); }
          .buttonSecondary { background-color: transparent; color: #2563eb; border-color: #2563eb; }
          .buttonSecondary:hover { background-color: #f0f9ff; }
          .container { width: 100%; margin: 0 auto; padding: 0; }
          @media (max-width: 768px) {
            .heroTitle { font-size: 2rem; }
            .heroSubtitle { font-size: 1rem; }
            .button { padding: 0.75rem 1.5rem; font-size: 0.875rem; }
          }
        `}} />
      </head>
      <body>
        <RootLayoutClient>
          {children}
        </RootLayoutClient>
      </body>
    </html>
  );
}
