'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCart } from '@/contexts/CartContext';
import Link from 'next/link';
import { CheckCircle2, Home, ShoppingBag } from 'lucide-react';
import styles from '@/app/checkout/success/SuccessPage.module.css';

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.com';

export function CheckoutSuccess({
  orderLookupPath = '/api/payment/order-number',
  checkoutToken = '',
}: { orderLookupPath?: string; checkoutToken?: string }) {
  const searchParams = useSearchParams();
  const { clearCart } = useCart();
  const [mounted, setMounted] = useState(false);
  const [order, setOrder] = useState<{ orderNumber: number; shopifyOrderId: string; shopDomain?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const paymentIntentId = searchParams.get('payment_intent');
  const checkoutSessionId = searchParams.get('checkout_session_id');

  useEffect(() => {
    setMounted(true);
    let timer: NodeJS.Timeout;
    let attempts = 0;
    const maxAttempts = 10;
    const pollOrder = async () => {
      if (attempts >= maxAttempts) {
        setLoading(false);
        return;
      }
      try {
        const params = new URLSearchParams();
        if (paymentIntentId) params.set('payment_intent', paymentIntentId);
        if (checkoutSessionId) params.set('checkout_session_id', checkoutSessionId);
        if (checkoutToken) params.set('checkout_token', checkoutToken);
        const response = await fetch(`${orderLookupPath}?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setOrder({ orderNumber: data.orderNumber, shopifyOrderId: data.shopifyOrderId, shopDomain: data.shopDomain });
          setLoading(false);
        } else if (response.status === 404) {
          attempts += 1;
          timer = setTimeout(pollOrder, 2000);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    };
    if (paymentIntentId || checkoutSessionId) pollOrder();
    else setLoading(false);
    return () => clearTimeout(timer);
  }, [checkoutSessionId, checkoutToken, orderLookupPath, paymentIntentId]);

  useEffect(() => {
    if (order) clearCart();
  }, [clearCart, order]);

  if (!mounted) return null;
  return (
    <div className={styles.successContainer}>
      <div className={styles.successCard}>
        <div className={styles.successIconContainer}><div className={styles.successIconCircle}><CheckCircle2 className={styles.successIcon} /></div></div>
        <h1 className={styles.successTitle}>Order Confirmed</h1>
        <p className={styles.successSubtitle}>Thank you for your purchase. Your order has been successfully processed.</p>
        <div className={styles.confirmationBox}>
          <p className={styles.confirmationLabel}>Your Order Number</p>
          {loading ? <div className={styles.orderNumberLoading} /> : order ? <p data-testid="order-number" className={styles.orderNumber}>#{order.orderNumber}</p> : <p className={styles.orderNumberFallback}>Processing order...</p>}
        </div>
        {order?.shopDomain && <div className={styles.devPortalBox}><p className={styles.devPortalLabel}>Order reference</p><a href={`https://admin.shopify.com/store/${order.shopDomain.split('.')[0]}/orders/${order.shopifyOrderId}`} target="_blank" rel="noopener noreferrer" className={styles.devPortalLink}>Open order in Shopify Admin</a></div>}
        <div className={styles.orderDetailsBox}>
          <div className={styles.detailRow}><ShoppingBag className={styles.detailIcon} /><div className={styles.detailContent}><p className={styles.detailLabel}>Order Status</p><p className={styles.detailValue}>Processing</p></div></div>
          <div className={styles.detailRow}><span className={styles.detailEmoji}>Email</span><div className={styles.detailContent}><p className={styles.detailLabel}>Next Step</p><p className={styles.detailValue}>Check your email for confirmation</p></div></div>
        </div>
        <div className={styles.actionsContainer}><Link href="/products" className={styles.primaryAction}>Continue Shopping</Link><Link href="/" className={styles.secondaryAction}><Home className={styles.homeIcon} />Back Home</Link></div>
        <p className={styles.supportText}>Questions? <a href={`mailto:${supportEmail}`} className={styles.supportLink}>Contact support</a></p>
      </div>
    </div>
  );
}
