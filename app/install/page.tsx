import styles from './InstallPage.module.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Install Omni Checkout',
  robots: { index: false, follow: false },
};

export default async function InstallPage({ searchParams }: { searchParams?: Promise<{ installed?: string; shop?: string }> }) {
  const query = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Omni Checkout</p>
        <h1>Install the Shopify app</h1>
        {query?.installed === '1' ? (
          <div className={styles.success} role="status">
            <strong>Shopify store connected</strong>
            <span>{query.shop || 'The store'} is ready. Shopify connection parameters are managed automatically by the app.</span>
          </div>
        ) : (
          <p>Connect a Shopify store to enable App Proxy checkout and Draft Order routing.</p>
        )}
        <form action="/api/auth/shopify" method="get" className={styles.form}>
          <label htmlFor="shop">Shopify store domain</label>
          <input id="shop" name="shop" placeholder="your-store.myshopify.com" required pattern="[a-zA-Z0-9-]+\\.myshopify\\.com" />
          <button type="submit">Connect Shopify</button>
        </form>
      </section>
    </main>
  );
}
