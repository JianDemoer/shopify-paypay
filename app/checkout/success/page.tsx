import { Suspense } from 'react';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';

export default function CheckoutSuccessPage() {
  return <Suspense fallback={<div style={{ minHeight: '100vh' }} />}><CheckoutSuccess /></Suspense>;
}
