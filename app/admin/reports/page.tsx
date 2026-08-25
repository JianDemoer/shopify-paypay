import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-auth';
import { cookies } from 'next/headers';
import { ReportsAdmin } from './ui';

export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  const sessionShop = verifyAdminSession(cookies().get(ADMIN_SESSION_COOKIE)?.value);
  return <ReportsAdmin adminTokenRequired={Boolean((process.env.ADMIN_CONFIG_TOKEN || process.env.NODE_ENV === 'production') && !sessionShop)} />;
}
