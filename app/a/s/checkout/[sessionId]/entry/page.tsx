import { ensureCheckoutSession } from '@/lib/checkout-sessions';
import { verifyAppProxySearchParams } from '@/lib/shopify-app-proxy';
import { OmniCheckout } from './ui';

interface PageProps {
  params: { sessionId: string };
  searchParams?: { cid?: string; step?: string };
}

export default function AppProxyCheckoutEntry({ params, searchParams }: PageProps) {
  if (!verifyAppProxySearchParams(searchParams || {})) {
    return <div>Invalid checkout signature.</div>;
  }

  const session = ensureCheckoutSession(params.sessionId, searchParams?.cid || '');

  return (
    <OmniCheckout
      initialSession={session}
      initialStep={searchParams?.step || 'contact'}
      cid={searchParams?.cid || session.cid}
    />
  );
}
