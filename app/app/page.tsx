import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-auth';
import { normalizeShopDomain } from '@/lib/shopify-oauth';

export const dynamic = 'force-dynamic';

export default async function ShopifyAppEntry({
  searchParams,
}: {
  searchParams?: Promise<{ shop?: string }>;
}) {
  const [query, cookieStore] = await Promise.all([searchParams, cookies()]);
  const requestedShop = normalizeShopDomain(query?.shop);
  const sessionShop = verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);

  if (sessionShop && (!requestedShop || sessionShop === requestedShop)) {
    redirect('/admin/stores');
  }
  if (requestedShop) {
    redirect(`/api/auth/shopify?shop=${encodeURIComponent(requestedShop)}`);
  }
  redirect('/install');
}
