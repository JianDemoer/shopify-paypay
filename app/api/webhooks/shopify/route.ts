import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { deleteStoreConfig } from '@/lib/store-configs';

function validHmac(body: string, provided: string) {
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '';
  if (!secret || !provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!validHmac(body, request.headers.get('x-shopify-hmac-sha256') || '')) return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  const topic = request.headers.get('x-shopify-topic') || '';
  const shop = request.headers.get('x-shopify-shop-domain') || '';
  if (topic === 'app/uninstalled' && shop) await deleteStoreConfig(shop);
  return NextResponse.json({ received: true });
}
