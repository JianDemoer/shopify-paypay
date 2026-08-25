import { redirect } from 'next/navigation';
import Stripe from 'stripe';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { getStoreConfig, publicStoreConfig } from '@/lib/store-configs';
import { findFunnelStep, normalizeFunnelConfigs } from '@/lib/funnel-configs';
import { resolveCheckoutLineItems } from '@/lib/shopify-admin';
import { processStripePaymentSucceeded } from '@/lib/stripe-payment-processing';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';
import { UpsellCheckout, UpsellWaiting } from './ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: { sessionId: string };
  searchParams?: {
    cid?: string;
    payment_intent?: string;
    parent_payment_intent?: string;
    payment_intent_client_secret?: string;
    redirect_status?: string;
    checkout_token?: string;
  };
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
  let session = await getCheckoutSession(params.sessionId);
  if (!session) return <div>Checkout session not found or expired.</div>;
  const fullStoreConfig = await getStoreConfig(session.storeId || session.shopDomain);
  if (!verifyCheckoutAccessToken(searchParams?.checkout_token, params.sessionId, fullStoreConfig.shopifyAppProxySecret)) return <div>Invalid checkout signature.</div>;

  const parentPaymentIntentId = searchParams?.parent_payment_intent || searchParams?.payment_intent || '';
  const returnedPaymentIntentId = searchParams?.parent_payment_intent ? searchParams?.payment_intent || '' : '';
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
        session = await getCheckoutSession(params.sessionId) || session;
      }
      if (returnedPaymentIntentId.startsWith('pi_') && returnedPaymentIntentId !== parentPaymentIntentId) {
        const returned = await stripe.paymentIntents.retrieve(returnedPaymentIntentId);
        if (returned.status === 'succeeded' && returned.metadata.checkoutSessionId === session.id && returned.metadata.purchaseKind === 'upsell') {
          await processStripePaymentSucceeded(returned, fullStoreConfig);
          session = await getCheckoutSession(params.sessionId) || session;
        }
      }
    } catch {
      parentConfirmed = false;
    }
  }
  if (!parentConfirmed) return <UpsellWaiting checkoutToken={searchParams?.checkout_token || ''} sessionId={session.id} />;

  const step = await stepForSession(fullStoreConfig, session);
  if (!step || step.type === 'thank_you') {
    redirect(`/a/s/checkout/${encodeURIComponent(session.id)}/success?checkout_session_id=${encodeURIComponent(session.id)}&payment_intent=${encodeURIComponent(parentPaymentIntentId)}&checkout_token=${encodeURIComponent(searchParams?.checkout_token || '')}`);
  }
  if (step.type !== 'upsell' && step.type !== 'downsell') return <UpsellWaiting checkoutToken={searchParams?.checkout_token || ''} sessionId={session.id} />;
  const offer = step.offer;
  if (!offer) return <UpsellWaiting checkoutToken={searchParams?.checkout_token || ''} sessionId={session.id} />;
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
      checkoutToken={searchParams?.checkout_token || ''}
    />
  );
}
