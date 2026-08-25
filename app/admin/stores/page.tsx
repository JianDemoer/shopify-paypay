import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-auth';
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

export default async function StoreAdminPage({ searchParams }: { searchParams?: { installed?: string; shop?: string } }) {
  const initialLocale = preferredLocale();
  const sessionShop = verifyAdminSession(cookies().get(ADMIN_SESSION_COOKIE)?.value);
  const installedShop = searchParams?.installed === '1' ? searchParams.shop : undefined;
  if ((process.env.ADMIN_CONFIG_TOKEN || isProductionRuntime()) && !sessionShop) {
    return <StoreAdmin initialStores={[]} adminTokenRequired initialLocale={initialLocale} installedShop={installedShop} />;
  }

  const stores = (await listStoreConfigs()).filter((store) => !sessionShop || store.shopDomain === sessionShop);
  return <StoreAdmin initialStores={stores.map((store) => ({
    ...publicStoreConfig(store),
    hasShopifyAdminAccessToken: Boolean(store.shopifyAdminAccessToken),
    hasStripeSecretKey: Boolean(store.stripeSecretKey),
    hasStripeWebhookSecret: Boolean(store.stripeWebhookSecret || store.stripeWebhookSecretProd),
    hasPaypalClientSecret: Boolean(store.paypalClientSecret),
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  }))} initialLocale={initialLocale} installedShop={installedShop} />;
}
