'use client';

import React from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import dynamic from 'next/dynamic';
import { CartProvider } from '@/contexts/CartContext';
import { usePathname } from 'next/navigation';

// Lazy load ChatWidget - not critical for initial render
const ChatWidget = dynamic(() => import('@/components/ChatWidget').then(mod => ({ default: mod.ChatWidget })), {
  ssr: false,
});

export function RootLayoutClient({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const standalone = pathname === '/install'
    || pathname === '/app'
    || pathname.startsWith('/admin/')
    || pathname.startsWith('/a/s/checkout/')
    || /^\/checkout\/[^/]+\/(entry|upsell|success)$/.test(pathname);

  return (
    <CartProvider>
      {standalone ? children : (
        <>
          <Header />
          <main className="min-h-screen">
            {children}
          </main>
          <Footer />
          <ChatWidget />
        </>
      )}
    </CartProvider>
  );
}
