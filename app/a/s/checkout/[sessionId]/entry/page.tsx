import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyAppProxySearchParams } from '@/lib/shopify-app-proxy';
import { getStoreConfig, publicStoreConfig } from '@/lib/store-configs';
import { OmniCheckout } from './ui';

interface PageProps {
  params: { sessionId: string };
  searchParams?: { cid?: string; step?: string };
}

export default async function AppProxyCheckoutEntry({ params, searchParams }: PageProps) {
  const session = await getCheckoutSession(params.sessionId);
  if (!session) {
    return <div>Checkout session not found or expired.</div>;
  }
  const fullStoreConfig = await getStoreConfig(session.storeId || session.shopDomain);

  if (!verifyAppProxySearchParams(searchParams || {}, fullStoreConfig.shopifyAppProxySecret)) {
    return <div>Invalid checkout signature.</div>;
  }

  const storeConfig = publicStoreConfig(fullStoreConfig);

  return (
    <OmniCheckout
      initialSession={session}
      storeConfig={storeConfig}
      initialStep={searchParams?.step || 'contact'}
      cid={searchParams?.cid || session.cid}
    />
  );
}
