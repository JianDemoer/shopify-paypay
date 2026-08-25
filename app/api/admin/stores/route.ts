import { NextRequest, NextResponse } from 'next/server';
import { deleteStoreConfig, listStoreConfigs, publicStoreConfig, saveStoreConfig } from '@/lib/store-configs';
import { isProductionRuntime } from '@/lib/runtime';

function isAuthorized(request: NextRequest) {
  const token = process.env.ADMIN_CONFIG_TOKEN;
  if (!token) return !isProductionRuntime();
  return request.headers.get('x-admin-token') === token;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configs = await listStoreConfigs();
  return NextResponse.json({
    stores: configs.map((config) => ({
      ...publicStoreConfig(config),
      hasShopifyAdminAccessToken: Boolean(config.shopifyAdminAccessToken),
      hasStripeSecretKey: Boolean(config.stripeSecretKey),
      hasStripeWebhookSecret: Boolean(config.stripeWebhookSecret || config.stripeWebhookSecretProd),
      hasPaypalClientSecret: Boolean(config.paypalClientSecret),
      storefrontAccessToken: config.storefrontAccessToken ? 'configured' : '',
      shopifyAppProxySecret: config.shopifyAppProxySecret ? 'configured' : '',
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await saveStoreConfig(await request.json());
    return NextResponse.json({ store: publicStoreConfig(config) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save store' },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing store id' }, { status: 400 });
  }

  await deleteStoreConfig(id);
  return NextResponse.json({ ok: true });
}
