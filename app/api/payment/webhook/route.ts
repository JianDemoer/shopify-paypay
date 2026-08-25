import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { listStoreConfigs, type StoreConfig } from '@/lib/store-configs';
import { clearFailedPrimaryPayment, getCheckoutSession, updateCheckoutSession } from '@/lib/checkout-sessions';
import { isProductionRuntime } from '@/lib/runtime';
import { processStripePaymentSucceeded } from '@/lib/stripe-payment-processing';

async function verifyStripeEvent(body: string, signature: string) {
  const configs = await listStoreConfigs();
  const isProduction = isProductionRuntime();
  for (const config of configs) {
    const webhookSecret = isProduction ? config.stripeWebhookSecretProd || config.stripeWebhookSecret : config.stripeWebhookSecret;
    if (!webhookSecret) continue;
    try {
      const stripe = new Stripe(config.stripeSecretKey);
      const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      const metadata = (event.data.object as Stripe.PaymentIntent).metadata || {};
      if (event.type.startsWith('payment_intent.') && metadata.storeId !== config.id) continue;
      return { event, storeConfig: config };
    } catch {
      // This endpoint supports multiple stores with one verified secret per store.
    }
  }
  throw new Error('No Stripe webhook secret matched this signature');
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  const body = await request.text();
  let event: Stripe.Event;
  let storeConfig: StoreConfig;
  try {
    const verified = await verifyStripeEvent(body, signature);
    event = verified.event;
    storeConfig = verified.storeConfig;
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      await processStripePaymentSucceeded(event.data.object as Stripe.PaymentIntent, storeConfig);
    } else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const sessionId = paymentIntent.metadata?.checkoutSessionId;
      if (sessionId) {
        const session = await getCheckoutSession(sessionId);
        if (session?.storeId === storeConfig.id) {
          if (paymentIntent.metadata?.purchaseKind === 'upsell') {
            const stepId = paymentIntent.metadata?.stepId || session.currentStepId || '';
            const current = session.upsellStates?.[stepId];
            await updateCheckoutSession(sessionId, {
              upsellStates: {
                ...(session.upsellStates || {}),
                [stepId]: { ...(current || { offerId: stepId, stepId }), paymentId: paymentIntent.id, paymentStatus: 'failed' },
              },
              upsellPaymentId: paymentIntent.id,
              upsellPaymentStatus: 'failed',
            });
          } else {
            await updateCheckoutSession(sessionId, { primaryPaymentId: paymentIntent.id, primaryPaymentStatus: 'failed' });
            await clearFailedPrimaryPayment(sessionId, paymentIntent.id);
          }
        }
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing failed:', error);
    return NextResponse.json({ error: 'Order processing failed' }, { status: 500 });
  }
}
