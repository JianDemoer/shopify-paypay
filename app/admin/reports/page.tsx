import { ReportsAdmin } from './ui';

export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  return <ReportsAdmin adminTokenRequired={Boolean(process.env.ADMIN_CONFIG_TOKEN || process.env.NODE_ENV === 'production')} />;
}
