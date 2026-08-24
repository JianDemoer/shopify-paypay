'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { AlertCircle, Loader2 } from 'lucide-react';
import styles from './CheckoutComponents.module.css';

interface PaymentStepProps {
  clientSecret: string | null;
  publishableKey?: string;
  isLoading?: boolean;
  returnUrl?: string;
  onSuccess?: (paymentIntentId: string) => void;
  onError?: (error: string) => void;
}

function PaymentForm({
  clientSecret,
  isLoading,
  returnUrl,
  onSuccess,
  onError,
}: PaymentStepProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || !clientSecret) {
      setError('Payment form not ready. Please refresh and try again.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Step 1: MUST CALL THIS FIRST
      // This triggers form validation and prepares the data
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message || 'Form validation failed');
        onError?.(submitError.message || 'Form validation failed');
        setSubmitting(false);
        return;
      }

      // Step 2: Now safely confirm payment with Stripe
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl || `${window.location.origin}/checkout/success`,
        },
      });

      if (result.error) {
        setError(result.error.message || 'Payment failed');
        onError?.(result.error.message || 'Payment failed');
      } else {
        // confirmPayment redirects to success URL on success, so this may not always execute
        // But we handle it just in case
        onSuccess?.((result as any).paymentIntent?.id || 'payment-success');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.paymentForm}>
      {error && (
        <div className={styles.errorAlert}>
          <AlertCircle className={styles.errorIcon} />
          <p className={styles.errorMessage}>{error}</p>
        </div>
      )}

      <div className={styles.paymentDetailsBox}>
        <label className={styles.paymentDetailsLabel}>
          Payment Details
        </label>
        <div className={styles.paymentElementContainer}>
          {clientSecret ? (
            <PaymentElement
              options={{
                layout: 'tabs',
                wallets: {
                  applePay: 'auto',
                  googlePay: 'auto',
                },
              }}
            />
          ) : (
            <div className={styles.paymentLoadingPlaceholder}>
              <span className={styles.paymentLoadingText}>Loading payment form...</span>
            </div>
          )}
        </div>
        <p className={styles.testCardInfo}>
          💳 Test: 4242 4242 4242 4242
        </p>
      </div>

      <button
        type="submit"
        data-testid="complete-purchase-btn"
        disabled={submitting || !stripe || !elements || !clientSecret || isLoading}
        className={styles.completeButton}
      >
        {submitting ? (
          <>
            <Loader2 className={styles.spinnerIcon} />
            Securely processing payment...
          </>
        ) : (
          'Complete Purchase'
        )}
      </button>
    </form>
  );
}

export function PaymentStep(props: PaymentStepProps) {
  const [mounted, setMounted] = useState(false);
  const stripePromise = useMemo(
    () => loadStripe(props.publishableKey || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''),
    [props.publishableKey]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={styles.paymentLoadingPlaceholder} style={{ height: '20rem' }} />
    );
  }

  if (!props.clientSecret) {
    return (
      <div className={styles.paymentLoadingPlaceholder} style={{ height: '20rem' }}>
        <Loader2 className={styles.spinnerIcon} />
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#2563eb',
          },
        },
      }}
    >
      <PaymentForm {...props} />
    </Elements>
  );
}
