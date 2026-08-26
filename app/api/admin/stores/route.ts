import { NextRequest, NextResponse } from 'next/server';
import { adminAccessForRequest, adminMutationAccessForRequest } from '@/lib/admin-auth';
import { normalizeShopDomain } from '@/lib/shopify-oauth';
import { deleteStoreConfig, listStoreConfigs, publicStoreConfig, saveStoreConfig } from '@/lib/store-configs';

export async function GET(request: NextRequest) {
  const access = adminAccessForRequest(request);
  if (!access) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configs = (await listStoreConfigs()).filter((config) => access.kind === 'global' || config.shopDomain === access.shopDomain);
  return NextResponse.json({
    stores: configs.map((config) => ({
      ...publicStoreConfig(config),
      hasShopifyAdminAccessToken: Boolean(config.shopifyAdminAccessToken),
      hasShopifyAppProxySecret: Boolean(config.shopifyAppProxySecret),
      hasStripeSecretKey: Boolean(config.stripeSecretKey),
      hasStripeWebhookSecret: Boolean(config.stripeWebhookSecret || config.stripeWebhookSecretProd),
      hasPaypalClientSecret: Boolean(config.paypalClientSecret),
      storefrontAccessToken: config.storefrontAccessToken ? 'configured' : '',
      shopifyAppProxySecret: config.shopifyAppProxySecret ? 'configured' : '',
      shopifyScopes: config.shopifyScopes || '',
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const access = adminMutationAccessForRequest(request);
  if (!access) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const input = await request.json();
    if (access.kind === 'shop' && normalizeShopDomain(input.shopDomain) !== access.shopDomain) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const config = await saveStoreConfig(input);
    return NextResponse.json({ store: publicStoreConfig(config) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save store' },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const access = adminMutationAccessForRequest(request);
  if (!access) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing store id' }, { status: 400 });
  }

  if (access.kind === 'shop') {
    const config = (await listStoreConfigs()).find((item) => item.id === id || item.shopDomain === id);
    if (!config || config.shopDomain !== access.shopDomain) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await deleteStoreConfig(id);
  return NextResponse.json({ ok: true });
}
