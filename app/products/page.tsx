import Link from 'next/link';
import { getProducts, ShopifyConfigurationError } from '@/lib/shopify';
import { ProductCard } from '@/components/ProductCard';
import styles from './ProductsPage.module.css';

// Force dynamic rendering - don't prerender at build time
export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  let products: Awaited<ReturnType<typeof getProducts>> = [];
  let needsConfiguration = false;
  try {
    products = await getProducts();
  } catch (error) {
    if (!(error instanceof ShopifyConfigurationError)) throw error;
    needsConfiguration = true;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>All Products</h1>
      
      {needsConfiguration ? (
        <div className={styles.emptyState}>
          <h2>Shopify app not installed</h2>
          <p>Install the Shopify app to load the store catalog automatically.</p>
          <Link href="/install" className={styles.configureLink}>Install app</Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
