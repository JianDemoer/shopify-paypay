import { listStoreConfigs, publicStoreConfig } from '@/lib/store-configs';
import { StoreAdmin } from './ui';

export default async function StoreAdminPage() {
  if (process.env.ADMIN_CONFIG_TOKEN) {
    return <StoreAdmin initialStores={[]} adminTokenRequired />;
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
  }))} />;
}
