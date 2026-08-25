'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './ReportsAdmin.module.css';

type Locale = 'zh' | 'en';
type Summary = {
  sessions: number;
  checkoutStarted: number;
  orders: number;
  orderConversionRate: number;
  mainPaid: number;
  revenue: number;
  upsellOrders: number;
  upsellRevenue: number;
  upsellConversionRate: number;
};

const copy = {
  zh: { title: '结账报表', description: '查看最近 30 天的订单、收入和加购漏斗表现。', token: '后台令牌', load: '加载报表', loading: '加载中...', store: '店铺', all: '全部店铺', sessions: '结账会话', orders: '订单', cr: '订单转化率', revenue: '总收入', upsellRevenue: '加购收入', upsellOrders: '加购订单', upsellCr: '加购转化率', back: '店铺配置', error: '报表加载失败。' },
  en: { title: 'Checkout Reports', description: 'Review the last 30 days of orders, revenue, and upsell funnel performance.', token: 'Admin token', load: 'Load report', loading: 'Loading...', store: 'Store', all: 'All stores', sessions: 'Checkout sessions', orders: 'Orders', cr: 'Order CR', revenue: 'Total revenue', upsellRevenue: 'Upsell revenue', upsellOrders: 'Upsell orders', upsellCr: 'Upsell CR', back: 'Store configuration', error: 'Unable to load reports.' },
};

export function ReportsAdmin({ adminTokenRequired }: { adminTokenRequired: boolean }) {
  const [locale, setLocale] = useState<Locale>('en');
  const [token, setToken] = useState('');
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const t = copy[locale];

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
      const response = await fetch(`/api/admin/reports${params}`, { headers: token ? { 'x-admin-token': token } : {} });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || t.error);
      setSummary(json.summary);
      setStores(json.stores || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setLoading(false);
    }
  }, [storeId, t.error, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadReport(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  return (
    <main className={styles.page} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Omni Checkout</p><h1>{t.title}</h1><p>{t.description}</p></div>
        <div className={styles.headerActions}>
          <div className={styles.languageSwitch}><button type="button" className={locale === 'zh' ? styles.active : ''} onClick={() => setLocale('zh')}>中文</button><button type="button" className={locale === 'en' ? styles.active : ''} onClick={() => setLocale('en')}>EN</button></div>
          <a href="/admin/stores">{t.back}</a>
        </div>
      </header>
      <section className={styles.toolbar}>
        {adminTokenRequired && <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t.token} aria-label={t.token} />}
        <label><span>{t.store}</span><select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">{t.all}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <button type="button" onClick={loadReport} disabled={loading}>{loading ? t.loading : t.load}</button>
      </section>
      {error && <p className={styles.error}>{error}</p>}
      {summary && <section className={styles.metrics}>
        <Metric label={t.sessions} value={summary.sessions.toLocaleString()} />
        <Metric label={t.orders} value={summary.orders.toLocaleString()} />
        <Metric label={t.cr} value={`${(summary.orderConversionRate * 100).toFixed(2)}%`} />
        <Metric label={t.revenue} value={summary.revenue.toFixed(2)} />
        <Metric label={t.upsellRevenue} value={summary.upsellRevenue.toFixed(2)} />
        <Metric label={t.upsellOrders} value={summary.upsellOrders.toLocaleString()} />
        <Metric label={t.upsellCr} value={`${(summary.upsellConversionRate * 100).toFixed(2)}%`} />
      </section>}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}
