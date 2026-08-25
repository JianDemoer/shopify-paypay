import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoreAdmin } from '../ui';

global.fetch = jest.fn();

const configuredStore = {
  id: 'demo.myshopify.com',
  name: 'Demo Store',
  shopDomain: 'demo.myshopify.com',
  currency: 'USD',
  orderMode: 'draft_order' as const,
  stripePublishableKey: 'pk_test_demo',
  paypalClientId: '',
  paypalEnv: 'sandbox' as const,
  standardShipping: 3.99,
  expressShipping: 5.99,
  taxRate: 0,
};

describe('StoreAdmin language switching', () => {
  beforeEach(() => {
    document.cookie = 'admin_locale=; Path=/; Max-Age=0';
    (global.fetch as jest.Mock).mockReset();
    jest.restoreAllMocks();
  });

  it('switches the complete admin form to Chinese and persists the preference', () => {
    render(<StoreAdmin initialStores={[]} initialLocale="en" />);

    expect(screen.getByRole('heading', { name: 'Store Configuration' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '中文' }));

    expect(screen.getByRole('heading', { name: '店铺配置' })).toBeInTheDocument();
    expect(screen.getByLabelText('Shopify 店铺域名')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存店铺' })).toBeInTheDocument();
    expect(document.cookie).toContain('admin_locale=zh');
  });

  it('retranslates an existing edit message when the language changes', () => {
    render(<StoreAdmin initialStores={[configuredStore]} initialLocale="en" />);

    fireEvent.click(screen.getByRole('button', { name: /Demo Store/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Secrets are not loaded back into the form');

    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByRole('status')).toHaveTextContent('出于安全原因，密钥不会回填');
    expect(screen.getByText('1 个店铺')).toBeInTheDocument();
  });

  it('shows known API errors in the selected language', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response);
    render(<StoreAdmin initialStores={[]} initialLocale="zh" />);

    fireEvent.click(screen.getByRole('button', { name: '保存店铺' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('管理令牌无效或无权访问');
    });
  });
});
