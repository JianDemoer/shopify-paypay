import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig } from '@/lib/store-configs';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{ checkout_token?: string; preview?: string }>;
}

export default async function AppProxySuccessPage({ params, searchParams }: PageProps) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const session = await getCheckoutSession(sessionId);
  if (!session) return <div>Checkout session not found or expired.</div>;
  const storeConfig = await getStoreConfig(session.storeId);
  if (!verifyCheckoutAccessToken(query?.checkout_token, session.id, storeConfig.shopifyAppProxySecret)) {
    return <div>Invalid checkout signature.</div>;
  }
  if (query?.preview === '1') {
    return (
      <main style={{ maxWidth: 640, margin: '72px auto', padding: 24, fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <h1>Funnel preview complete</h1>
        <p>All selected offer paths were recorded for this Draft Order. No payment was collected and no Shopify order was completed.</p>
        <a href={`/a/s/checkout/${encodeURIComponent(session.id)}/entry?cid=${encodeURIComponent(session.cid)}&checkout_token=${encodeURIComponent(query?.checkout_token || '')}&step=payment_method`}>Return to order review</a>
      </main>
    );
  }
  return <CheckoutSuccess orderLookupPath="/a/s/api/payment/order-number" checkoutToken={query?.checkout_token || ''} />;
}
