import { getProduct, ShopifyConfigurationError } from '@/lib/shopify';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AddToCart } from '@/components/AddToCart';
import type { Metadata } from 'next';
import { generateProductSchema } from '@/lib/structured-data';
import styles from './ProductPage.module.css';

// Force dynamic rendering - don't prerender at build time
export const dynamic = 'force-dynamic';

interface ProductPageProps {
  params: Promise<{
    handle: string;
  }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { handle } = await params;
  let product;
  try {
    product = await getProduct(handle);
  } catch (error) {
    if (!(error instanceof ShopifyConfigurationError)) throw error;
    return { title: 'Shopify app not installed' };
  }

  if (!product) {
    return {
      title: 'Product Not Found',
    };
  }

  const defaultVariant = product.variants[0];
  const price = defaultVariant?.price?.amount || '0';
  const currency = defaultVariant?.price?.currencyCode || 'USD';
  const imageUrl = product.featuredImage?.url || '/placeholder.jpg';

  return {
    title: product.title,
    description: product.description || `Shop ${product.title} - Premium quality products at great prices.`,
    openGraph: {
      title: product.title,
      description: product.description || `Shop ${product.title}`,
      type: 'website',
      images: [{
        url: imageUrl,
        width: 800,
        height: 800,
        alt: product.title,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: product.title,
      description: product.description || `Shop ${product.title}`,
      images: [imageUrl],
    },
    other: {
      'product:price:amount': price,
      'product:price:currency': currency,
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { handle } = await params;
  let product: Awaited<ReturnType<typeof getProduct>>;
  try {
    product = await getProduct(handle);
  } catch (error) {
    if (!(error instanceof ShopifyConfigurationError)) throw error;
    return (
      <div className={styles.container}>
        <div className={styles.infoContainer}>
          <h1 className={styles.title}>Shopify app not installed</h1>
          <p className={styles.description}>Install the Shopify app to load products automatically.</p>
          <Link href="/install">Install app</Link>
        </div>
      </div>
    );
  }

  if (!product) {
    notFound();
  }

  const defaultVariant = product.variants[0];

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://shopify-headless-lemon.vercel.app';
  const productSchema = generateProductSchema(product, siteUrl);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <div className={styles.container}>
        <div className={styles.grid}>
          {/* Product Image */}
          <div className={styles.imageContainer}>
          {product.featuredImage && (
            <Image
              src={product.featuredImage.url}
              alt={product.featuredImage.altText || product.title}
              fill
              className={styles.image}
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          )}
          </div>

          {/* Product Info */}
          <div className={styles.infoContainer}>
            <h1 className={styles.title}>{product.title}</h1>
            
            {product.vendor && (
              <p className={styles.vendor}>by {product.vendor}</p>
            )}

            <div className={styles.price}>
              ${defaultVariant.price.amount}
            </div>

            <div 
              className={styles.description}
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />

            <AddToCart 
              variantId={defaultVariant.id}
              availableForSale={product.availableForSale}
              productTitle={product.title}
              productImage={product.featuredImage?.url}
              price={defaultVariant.price.amount}
              variant={defaultVariant.title}
            />

            {/* Product Details */}
            <div className={styles.details}>
              <h3 className={styles.detailsTitle}>Product Details</h3>
              <ul className={styles.detailsList}>
                {product.availableForSale ? (
                  <li>✓ In Stock</li>
                ) : (
                  <li>✗ Out of Stock</li>
                )}
                {product.vendor && <li>Vendor: {product.vendor}</li>}
                {product.productType && <li>Type: {product.productType}</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
