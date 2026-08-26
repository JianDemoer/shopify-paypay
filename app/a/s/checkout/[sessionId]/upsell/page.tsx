import { redirect } from 'next/navigation';
import Stripe from 'stripe';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig, publicStoreConfig } from '@/lib/store-configs';
import { findFunnelStep, normalizeFunnelConfigs } from '@/lib/funnel-configs';
import { resolveCheckoutLineItems } from '@/lib/shopify-admin';
import { processStripePaymentSucceeded } from '@/lib/stripe-payment-processing';
import { UpsellCheckout, UpsellWaiting } from './ui';
import { firstPendingPostPurchaseStep } from '@/lib/funnel-runtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{
    cid?: string;
    payment_intent?: string;
    parent_payment_intent?: string;
    payment_intent_client_secret?: string;
    redirect_status?: string;
    checkout_token?: string;
    preview?: string;
  }>;
}

async function stepForSession(storeConfig: Awaited<ReturnType<typeof getStoreConfig>>, session: Awaited<ReturnType<typeof getCheckoutSession>>) {
  if (!session?.funnelId || !session.funnelVersionId || !session.currentStepId) return undefined;
  return findFunnelStep(
    normalizeFunnelConfigs(storeConfig.funnels, { variantId: storeConfig.upsellVariantId, productId: storeConfig.upsellProductId }),
    session.funnelId,
    session.funnelVersionId,
    session.currentStepId
  );
}

export default async function AppProxyUpsellPage({ params, searchParams }: PageProps) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  let session = await getCheckoutSession(sessionId);
  if (!session) return <div>Checkout session not found or expired.</div>;
  const fullStoreConfig = await getStoreConfig(session.storeId || session.shopDomain);
  if (!verifyCheckoutAccessToken(query?.checkout_token, sessionId, fullStoreConfig.shopifyAppProxySecret)) return <div>Invalid checkout signature.</div>;
  const previewMode = query?.preview === '1';

  const parentPaymentIntentId = query?.parent_payment_intent || query?.payment_intent || '';
  const returnedPaymentIntentId = query?.parent_payment_intent ? query?.payment_intent || '' : '';
  let parentConfirmed = parentPaymentIntentId.startsWith('paypal:')
    ? session.primaryPaymentStatus === 'paid' && session.primaryPaymentId === parentPaymentIntentId
    : false;

  if (parentPaymentIntentId.startsWith('pi_')) {
    try {
      const stripe = new Stripe(fullStoreConfig.stripeSecretKey);
      const parent = await stripe.paymentIntents.retrieve(parentPaymentIntentId);
      parentConfirmed = parent.status === 'succeeded'
        && parent.metadata.checkoutSessionId === session.id
        && parent.metadata.storeId === fullStoreConfig.id
        && parent.metadata.purchaseKind === 'main';
      if (parentConfirmed && session.primaryPaymentStatus !== 'paid') {
        await processStripePaymentSucceeded(parent, fullStoreConfig);
        session = await getCheckoutSession(sessionId) || session;
      }
      if (returnedPaymentIntentId.startsWith('pi_') && returnedPaymentIntentId !== parentPaymentIntentId) {
        const returned = await stripe.paymentIntents.retrieve(returnedPaymentIntentId);
        if (returned.status === 'succeeded' && returned.metadata.checkoutSessionId === session.id && returned.metadata.purchaseKind === 'upsell') {
          await processStripePaymentSucceeded(returned, fullStoreConfig);
          session = await getCheckoutSession(sessionId) || session;
        }
      }
    } catch {
      parentConfirmed = false;
    }
  }
  if (!previewMode && !parentConfirmed) return <UpsellWaiting checkoutToken={query?.checkout_token || ''} sessionId={session.id} />;
  if (previewMode && (session.checkoutStatus !== 'ready_for_payment' || !session.primaryDraftOrderId)) {
    redirect(`/a/s/checkout/${encodeURIComponent(session.id)}/entry?cid=${encodeURIComponent(session.cid)}&checkout_token=${encodeURIComponent(query?.checkout_token || '')}&step=payment_method`);
  }

  const step = previewMode
    ? firstPendingPostPurchaseStep(fullStoreConfig, session)
    : await stepForSession(fullStoreConfig, session);
  if (!step || step.type === 'thank_you') {
    const params = new URLSearchParams({ checkout_session_id: session.id, checkout_token: query?.checkout_token || '' });
    if (parentPaymentIntentId) params.set('payment_intent', parentPaymentIntentId);
    if (previewMode) params.set('preview', '1');
    redirect(`/a/s/checkout/${encodeURIComponent(session.id)}/success?${params.toString()}`);
  }
  if (step.type !== 'upsell' && step.type !== 'downsell') return <UpsellWaiting checkoutToken={query?.checkout_token || ''} sessionId={session.id} />;
  const offer = step.offer;
  if (!offer) return <UpsellWaiting checkoutToken={query?.checkout_token || ''} sessionId={session.id} />;
  const resolved = await resolveCheckoutLineItems(fullStoreConfig, { variantId: offer.variantId, quantity: offer.quantity });
  const offerItem = offer.priceOverride === undefined ? resolved[0] : { ...resolved[0], price: offer.priceOverride };

  return (
    <UpsellCheckout
      session={session}
      storeConfig={publicStoreConfig(fullStoreConfig)}
      step={step}
      offerItem={offerItem}
      cid={session.cid}
      parentPaymentIntentId={parentPaymentIntentId}
      checkoutToken={query?.checkout_token || ''}
      previewMode={previewMode}
    />
  );
}
