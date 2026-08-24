import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createShopifyDraftOrder } from '@/lib/shopify-admin';
import { getStoreConfig } from '@/lib/store-configs';
import { getCheckoutSession } from '@/lib/checkout-sessions';

/**
 * POST /api/payment/create-intent
 * Creates a Stripe Payment Intent with smart metadata for webhook processing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      currency = 'usd',
      email,
      cartId,
      checkoutSessionId,
      cid,
      shippingAddress,
      shippingMethod,
      sourceUrl,
      utm,
      parentPaymentIntentId,
      orderType,
    } = body;

    const sessionId = checkoutSessionId || cartId;
    const session = sessionId ? await getCheckoutSession(sessionId) : null;
    if (!session) {
      return NextResponse.json(
        { error: 'Checkout session not found' },
        { status: 400 }
      );
    }

    const shipping = shippingMethod === 'express' ? 5.99 : session.shipping;
    const amount = Number((session.subtotal + shipping + session.tax).toFixed(2));
    const lineItems = session.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      title: item.title,
      price: item.price,
    }));

    let draftOrderId = '';
    let draftOrderInvoiceUrl = '';
    const storeConfig = await getStoreConfig(session.storeId || session.shopDomain);
    const stripe = new Stripe(storeConfig.stripeSecretKey);
    const shouldCreateDraftOrder = storeConfig.orderMode === 'draft_order';

    if (shouldCreateDraftOrder) {
      const draftOrder = await createShopifyDraftOrder({
        storeConfig,
        email: email || shippingAddress?.email || 'noreply@draft-order.local',
        firstName: shippingAddress?.firstName || 'Guest',
        lastName: shippingAddress?.lastName || 'Customer',
        lineItems,
        shippingAddress: shippingAddress || {},
        cartId: session.id,
        checkoutSessionId: session.id,
        cid,
        sourceUrl,
        shippingMethod,
        orderType: orderType || 'checkout',
        utm: utm || {},
        draftKey: `${session.id}:${Date.now()}`,
      });
      draftOrderId = draftOrder.id;
      draftOrderInvoiceUrl = draftOrder.invoice_url || '';
    }

    // Create Payment Intent with metadata for webhook
    // Note: Email is optional here; we'll get it from Stripe's payment method if available
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: session.currency.toLowerCase() || currency,
      description: email ? `Order for ${email}` : 'Order',
      ...(email && { receipt_email: email }), // Only set receipt_email if provided
      
      // KEY: Metadata passed to webhook for Shopify order creation
      metadata: {
        firstName: shippingAddress?.firstName || '',
        lastName: shippingAddress?.lastName || '',
        cartId: session.id,
        checkoutSessionId: session.id,
        storeId: storeConfig.id,
        shopDomain: storeConfig.shopDomain,
        cid: cid || '',
        sourceUrl: sourceUrl || '',
        shippingMethod: shippingMethod || '',
        parentPaymentIntentId: parentPaymentIntentId || '',
        orderType: orderType || 'checkout',
        draftOrderId,
        utm: JSON.stringify(utm || {}),
        lineItems: JSON.stringify(lineItems),
        shippingAddress: JSON.stringify(shippingAddress || {}),
        // Note: email NOT stored in metadata; we'll extract from PaymentIntent in webhook
      },

      // Automatically handle Apple Pay / Google Pay
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(`✅ Payment Intent created: ${paymentIntent.id}`);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      draftOrderId,
      draftOrderInvoiceUrl,
    });
  } catch (error) {
    console.error('Payment intent error:', error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
