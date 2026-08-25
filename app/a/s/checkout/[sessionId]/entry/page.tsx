import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig, publicStoreConfig } from '@/lib/store-configs';
import { OmniCheckout } from './ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{ cid?: string; step?: string; checkout_token?: string }>;
}

export default async function AppProxyCheckoutEntry({ params, searchParams }: PageProps) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const session = await getCheckoutSession(sessionId);
  if (!session) {
    return <div>Checkout session not found or expired.</div>;
  }
  const fullStoreConfig = await getStoreConfig(session.storeId || session.shopDomain);

  const access = verifyCheckoutAccessToken(
    query?.checkout_token,
    sessionId,
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
      initialStep={query?.step || 'contact'}
      cid={session.cid}
      checkoutToken={query?.checkout_token || ''}
    />
  );
}
