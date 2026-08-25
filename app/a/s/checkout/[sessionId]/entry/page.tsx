import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig, publicStoreConfig } from '@/lib/store-configs';
import { OmniCheckout } from './ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: { sessionId: string };
  searchParams?: { cid?: string; step?: string; checkout_token?: string };
}

export default async function AppProxyCheckoutEntry({ params, searchParams }: PageProps) {
  const session = await getCheckoutSession(params.sessionId);
  if (!session) {
    return <div>Checkout session not found or expired.</div>;
  }
  const fullStoreConfig = await getStoreConfig(session.storeId || session.shopDomain);

  const access = verifyCheckoutAccessToken(
    searchParams?.checkout_token,
    params.sessionId,
    fullStoreConfig.shopifyAppProxySecret
  );
  if (!access) {
    return <div>Invalid checkout signature.</div>;
  }

  const storeConfig = publicStoreConfig(fullStoreConfig);

  return (
    <OmniCheckout
      initialSession={session}
      storeConfig={storeConfig}
      initialStep={searchParams?.step || 'contact'}
      cid={session.cid}
      checkoutToken={searchParams?.checkout_token || ''}
    />
  );
}
