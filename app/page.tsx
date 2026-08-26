import Link from 'next/link';
import { getProducts, ShopifyConfigurationError } from '@/lib/shopify';
import { ProductCard } from '@/components/ProductCard';
import { HeroCarousel } from '@/components/HeroCarousel';
import { FamilyPlanPromo } from '@/components/FamilyPlanPromo';
import styles from './page.module.css';

// Force dynamic rendering - don't prerender at build time
export const dynamic = 'force-dynamic';

// Mock hero carousel images - replace with real product images
const heroImages = [
  {
    id: 1,
    src: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=1200&h=600&fit=crop',
    alt: 'Premium Tech Apparel',
    title: 'Premium Tech Collection',
    description: 'High-quality t-shirts designed for tech enthusiasts',
  },
  {
    id: 2,
    src: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1200&h=600&fit=crop',
    alt: 'Latest Innovation',
    title: 'Latest Innovation',
    description: 'Discover our newest designs and exclusive releases',
  },
  {
    id: 3,
    src: 'https://picsum.photos/1200/600?random=3',
    alt: 'Signature Style',
    title: 'Signature Style',
    description: 'Express yourself with our timeless collection',
  },
];

export default async function Home() {
  let products: Awaited<ReturnType<typeof getProducts>> = [];
  let needsConfiguration = false;
  try {
    products = await getProducts();
  } catch (error) {
    if (!(error instanceof ShopifyConfigurationError)) throw error;
    needsConfiguration = true;
  }

  return (
    <div className={styles.container} data-cy="homepage-container">
      {/* Hero Section - Above the Fold */}
      <section className={styles.heroSection} data-cy="hero-section">
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle} data-cy="hero-title">
            Welcome to Our Store
          </h1>
          <p className={styles.heroSubtitle} data-cy="hero-subtitle">
            Discover amazing products powered by Shopify
          </p>
          <div className={styles.heroButtons} data-cy="hero-buttons">
            <Link 
              href="/products"
              className={`${styles.button} ${styles.buttonPrimary}`}
              data-cy="shop-now-button"
            >
              Shop Now
            </Link>
            <Link 
              href="/family-plan"
              className={`${styles.button} ${styles.buttonSecondary}`}
              data-cy="build-family-plan-button"
            >
              Build Family Plan
            </Link>
          </div>
        </div>
      </section>

      {/* Hero Carousel - Image Section with Lazy Loading */}
      <HeroCarousel images={heroImages} />

      {/* Featured Products Section - After Carousel */}
      <section className={styles.productsSection} data-cy="featured-products-section">
        <h2 className={styles.sectionTitle} data-cy="featured-products-title">Featured Products</h2>
        {needsConfiguration ? (
          <div className={styles.emptyState}>
            <h3>Shopify app not installed</h3>
            <p>Install the Shopify app to connect this store and load its products automatically.</p>
            <Link href="/install" className={`${styles.button} ${styles.buttonPrimary}`}>Install app</Link>
          </div>
        ) : (
          <div className={styles.productsGrid} data-cy="featured-products-grid">
            {products.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* Family Plan Promo Section */}
      <FamilyPlanPromo />
    </div>
  );
}
