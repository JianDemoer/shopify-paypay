import { ensureCheckoutSession } from '@/lib/checkout-sessions';
import { verifyAppProxySearchParams } from '@/lib/shopify-app-proxy';
import { getStoreConfig, publicStoreConfig } from '@/lib/store-configs';
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
  const session = await ensureCheckoutSession(params.sessionId, searchParams?.cid || '');
  const fullStoreConfig = await getStoreConfig(session.storeId || session.shopDomain);

  if (!verifyAppProxySearchParams(searchParams || {}, fullStoreConfig.shopifyAppProxySecret)) {
    return <div>Invalid checkout signature.</div>;
  }

  const storeConfig = publicStoreConfig(fullStoreConfig);

  return (
    <UpsellCheckout
      session={session}
      storeConfig={storeConfig}
      cid={searchParams?.cid || session.cid}
      parentPaymentIntentId={searchParams?.payment_intent || ''}
    />
  );
}
