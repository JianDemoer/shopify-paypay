import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig } from '@/lib/store-configs';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{ checkout_token?: string }>;
}

export default async function AppProxySuccessPage({ params, searchParams }: PageProps) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const session = await getCheckoutSession(sessionId);
  if (!session) return <div>Checkout session not found or expired.</div>;
  const storeConfig = await getStoreConfig(session.storeId);
  if (!verifyCheckoutAccessToken(query?.checkout_token, session.id, storeConfig.shopifyAppProxySecret)) {
    return <div>Invalid checkout signature.</div>;
  }
  return <CheckoutSuccess orderLookupPath="/a/s/api/payment/order-number" checkoutToken={query?.checkout_token || ''} />;
}
