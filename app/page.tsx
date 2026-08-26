import { redirect } from 'next/navigation';
import { normalizeShopDomain } from '@/lib/shopify-oauth';

export const dynamic = 'force-dynamic';

export default async function RootAppEntry({
  searchParams,
}: {
  searchParams?: Promise<{ shop?: string }>;
}) {
  const query = await searchParams;
  const shop = normalizeShopDomain(query?.shop);
  const destination = shop
    ? `/app?shop=${encodeURIComponent(shop)}`
    : '/app';

  // Older Shopify Dev Dashboard versions can still point at the root URL.
  // Keep that URL as a safe compatibility entry instead of rendering the
  // removed consumer-storefront template inside Shopify Admin.
  redirect(destination);
}
