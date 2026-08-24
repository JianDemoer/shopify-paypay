import { ensureCheckoutSession } from '@/lib/checkout-sessions';
import { verifyAppProxySearchParams } from '@/lib/shopify-app-proxy';
import { UpsellCheckout } from './ui';

interface PageProps {
  params: { sessionId: string };
  searchParams?: {
    cid?: string;
    payment_intent?: string;
    payment_intent_client_secret?: string;
    redirect_status?: string;
  };
}

export default async function AppProxyUpsellPage({ params, searchParams }: PageProps) {
  if (!verifyAppProxySearchParams(searchParams || {})) {
    return <div>Invalid checkout signature.</div>;
  }

  const session = await ensureCheckoutSession(params.sessionId, searchParams?.cid || '');

  return (
    <UpsellCheckout
      session={session}
      cid={searchParams?.cid || session.cid}
      parentPaymentIntentId={searchParams?.payment_intent || ''}
    />
  );
}
