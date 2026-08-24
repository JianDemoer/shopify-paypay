import { ensureCheckoutSession } from '@/lib/checkout-sessions';
import { OmniCheckout } from './ui';

interface PageProps {
  params: { sessionId: string };
  searchParams?: { cid?: string; step?: string };
}

export default function AppProxyCheckoutEntry({ params, searchParams }: PageProps) {
  const session = ensureCheckoutSession(params.sessionId, searchParams?.cid || '');

  return (
    <OmniCheckout
      initialSession={session}
      initialStep={searchParams?.step || 'contact'}
      cid={searchParams?.cid || session.cid}
    />
  );
}
