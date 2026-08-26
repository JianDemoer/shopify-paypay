import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Secure Checkout',
  robots: { index: false, follow: false },
};

export default function AppProxyCheckoutLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
