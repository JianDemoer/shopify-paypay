import { listStoreConfigs, publicStoreConfig } from '@/lib/store-configs';
import { isProductionRuntime } from '@/lib/runtime';
import { cookies, headers } from 'next/headers';
import { StoreAdmin } from './ui';
import type { AdminLocale } from './ui';

export const dynamic = 'force-dynamic';

function preferredLocale(): AdminLocale {
  const saved = cookies().get('admin_locale')?.value;
  if (saved === 'zh' || saved === 'en') return saved;
  return headers().get('accept-language')?.toLowerCase().includes('zh') ? 'zh' : 'en';
}

export default async function StoreAdminPage() {
  const initialLocale = preferredLocale();
  if (process.env.ADMIN_CONFIG_TOKEN || isProductionRuntime()) {
    return <StoreAdmin initialStores={[]} adminTokenRequired initialLocale={initialLocale} />;
  }

  const stores = await listStoreConfigs();
  return <StoreAdmin initialStores={stores.map((store) => ({
    ...publicStoreConfig(store),
    hasShopifyAdminAccessToken: Boolean(store.shopifyAdminAccessToken),
    hasStripeSecretKey: Boolean(store.stripeSecretKey),
    hasStripeWebhookSecret: Boolean(store.stripeWebhookSecret || store.stripeWebhookSecretProd),
    hasPaypalClientSecret: Boolean(store.paypalClientSecret),
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  }))} initialLocale={initialLocale} />;
}
