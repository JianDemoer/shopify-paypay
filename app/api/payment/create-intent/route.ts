import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createShopifyDraftOrder } from '@/lib/shopify-admin';
import { getStoreConfig } from '@/lib/store-configs';

/**
 * POST /api/payment/create-intent
 * Creates a Stripe Payment Intent with smart metadata for webhook processing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      amount,
      currency = 'usd',
      email,
      cartId,
      checkoutSessionId,
      storeId,
      shopDomain,
      cid,
      lineItems,
      shippingAddress,
      shippingMethod,
      sourceUrl,
      utm,
      parentPaymentIntentId,
      orderType,
    } = body;

    // Validation
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

    let draftOrderId = '';
    let draftOrderInvoiceUrl = '';
    const storeConfig = await getStoreConfig(storeId || shopDomain);
    const stripe = new Stripe(storeConfig.stripeSecretKey);
    const shouldCreateDraftOrder = storeConfig.orderMode === 'draft_order' && cartId;

    if (shouldCreateDraftOrder) {
      const draftOrder = await createShopifyDraftOrder({
        storeConfig,
        email: email || shippingAddress?.email || 'noreply@draft-order.local',
        firstName: shippingAddress?.firstName || 'Guest',
        lastName: shippingAddress?.lastName || 'Customer',
        lineItems: lineItems || [],
        shippingAddress: shippingAddress || {},
        cartId: cartId || checkoutSessionId || '',
        checkoutSessionId: checkoutSessionId || cartId || '',
        cid,
        sourceUrl,
        shippingMethod,
        orderType: orderType || 'checkout',
        utm: utm || {},
        draftKey: `${cartId || checkoutSessionId}:${Date.now()}`,
      });
      draftOrderId = draftOrder.id;
      draftOrderInvoiceUrl = draftOrder.invoice_url || '';
    }

    // Create Payment Intent with metadata for webhook
    // Note: Email is optional here; we'll get it from Stripe's payment method if available
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      description: email ? `Order for ${email}` : 'Order',
      ...(email && { receipt_email: email }), // Only set receipt_email if provided
      
      // KEY: Metadata passed to webhook for Shopify order creation
      metadata: {
        firstName: shippingAddress?.firstName || '',
        lastName: shippingAddress?.lastName || '',
        cartId: cartId || checkoutSessionId || '',
        checkoutSessionId: checkoutSessionId || cartId || '',
        storeId: storeConfig.id,
        shopDomain: storeConfig.shopDomain,
        cid: cid || '',
        sourceUrl: sourceUrl || '',
        shippingMethod: shippingMethod || '',
        parentPaymentIntentId: parentPaymentIntentId || '',
        orderType: orderType || 'checkout',
        draftOrderId,
        utm: JSON.stringify(utm || {}),
        lineItems: JSON.stringify(lineItems || []),
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
