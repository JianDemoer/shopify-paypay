import {
  acquireCheckoutLock,
  getCheckoutSession,
  releaseCheckoutLock,
  updateCheckoutSession,
  type CheckoutCustomer,
  type CheckoutSession,
} from './checkout-sessions';
import { calculateTotals, normalizeSourceUrl, parseCustomer } from './checkout-pricing';
import { createShopifyDraftOrder, updateShopifyDraftOrder } from './shopify-admin';
import type { StoreConfig } from './store-configs';

export interface PrepareCheckoutInput {
  customer: unknown;
  shippingMethod: 'standard' | 'express';
  sourceUrl?: unknown;
}

export interface PreparedCheckout {
  session: CheckoutSession;
  createdDraft: boolean;
  submittedContact: boolean;
  reviewed: boolean;
}

function shippingMethod(value: unknown): 'standard' | 'express' {
  if (value === 'express') return 'express';
  if (value === 'standard' || value === undefined || value === null || value === '') return 'standard';
  throw new Error('Invalid shipping method');
}

function draftData(
  storeConfig: StoreConfig,
  session: CheckoutSession,
  customer: CheckoutCustomer,
  method: 'standard' | 'express',
  sourceUrl: string
) {
  const totals = calculateTotals(session.items, storeConfig, method, 'main');
  return {
    totals,
    input: {
      storeConfig,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      lineItems: session.items,
      shippingAddress: customer,
      shippingMethod: method,
      shippingPrice: totals.shipping,
      taxPrice: totals.tax,
      checkoutSessionId: session.id,
      cartId: session.id,
      cid: session.cid,
      sourceUrl,
    },
  };
}

/**
 * Saves checkout details before any payment provider is initialized. The draft
 * key makes recovery from a request retry safe even if Shopify succeeds first.
 */
export async function prepareCheckoutSession(
  sessionId: string,
  storeConfig: StoreConfig,
  rawInput: PrepareCheckoutInput
): Promise<PreparedCheckout> {
  const lockKey = `${storeConfig.id}:checkout-prepare:${sessionId}`;
  const lockToken = await acquireCheckoutLock(lockKey, 120);
  if (!lockToken) throw new Error('Checkout details are already being saved');

  try {
    const session = await getCheckoutSession(sessionId);
    if (!session || session.storeId !== storeConfig.id) throw new Error('Checkout session not found');
    if (session.finalizationStatus === 'completed' || session.primaryOrderId) {
      throw new Error('This checkout has already been completed');
    }

    const customer = parseCustomer(rawInput.customer, session.customer);
    const method = shippingMethod(rawInput.shippingMethod);
    const sourceUrl = normalizeSourceUrl(rawInput.sourceUrl);
    const { totals, input } = draftData(storeConfig, session, customer, method, sourceUrl);
    const submittedContact = !session.customer;
    const reviewed = session.checkoutStatus !== 'ready_for_payment';
    let draftOrderId = session.primaryDraftOrderId;
    let createdDraft = false;

    if (draftOrderId) {
      await updateShopifyDraftOrder({
        ...input,
        draftOrderId,
        tags: ['OPC-ReadyForPayment'],
        noteAttributes: [{ name: 'checkout_status', value: 'ready_for_payment' }],
      });
    } else {
      const draft = await createShopifyDraftOrder({
        ...input,
        draftKey: `${session.id}:main`,
      });
      draftOrderId = draft.id;
      createdDraft = true;
    }

    const updated = await updateCheckoutSession(session.id, {
      customer,
      primaryShippingMethod: method,
      primaryDraftOrderId: draftOrderId,
      subtotal: totals.subtotal,
      shipping: totals.shipping,
      tax: totals.tax,
      total: totals.total,
      checkoutStatus: 'ready_for_payment',
      checkoutPreparedAt: new Date().toISOString(),
    });

    return { session: updated, createdDraft, submittedContact, reviewed };
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}
