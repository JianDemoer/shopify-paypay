import styles from './InstallPage.module.css';

export default function InstallPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Omni Checkout</p>
        <h1>Install the Shopify app</h1>
        <p>Connect a Shopify store to enable App Proxy checkout and Draft Order routing.</p>
        <form action="/api/auth/shopify" method="get" className={styles.form}>
          <label htmlFor="shop">Shopify store domain</label>
          <input id="shop" name="shop" placeholder="your-store.myshopify.com" required pattern="[a-zA-Z0-9-]+\\.myshopify\\.com" />
          <button type="submit">Connect Shopify</button>
        </form>
      </section>
    </main>
  );
}
