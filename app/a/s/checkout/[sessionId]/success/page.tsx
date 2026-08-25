import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig } from '@/lib/store-configs';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: { sessionId: string };
  searchParams?: { checkout_token?: string };
}

export default async function AppProxySuccessPage({ params, searchParams }: PageProps) {
  const session = await getCheckoutSession(params.sessionId);
  if (!session) return <div>Checkout session not found or expired.</div>;
  const storeConfig = await getStoreConfig(session.storeId);
  if (!verifyCheckoutAccessToken(searchParams?.checkout_token, session.id, storeConfig.shopifyAppProxySecret)) {
    return <div>Invalid checkout signature.</div>;
  }
  return <CheckoutSuccess orderLookupPath="/a/s/api/payment/order-number" checkoutToken={searchParams?.checkout_token || ''} />;
}
