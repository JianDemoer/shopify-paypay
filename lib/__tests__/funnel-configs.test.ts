import {
  createLegacyDefaultFunnel,
  findFunnelVersion,
  firstPostPurchaseStep,
  nextFunnelStep,
  normalizeCheckoutZones,
  normalizeFunnelConfigs,
  selectFunnel,
} from '../funnel-configs';

function funnel(id: string, versionId = `${id}-v1`) {
  return {
    id,
    name: id,
    enabled: true,
    publishedVersionId: versionId,
    versions: [{
      id: versionId,
      version: 1,
      status: 'published',
      entryStepId: 'checkout',
      steps: [
        { id: 'checkout', type: 'checkout', name: 'Checkout', enabled: true, acceptNextStepId: 'offer', triggerRules: [] },
        {
          id: 'offer',
          type: 'upsell',
          name: 'Offer',
          enabled: true,
          acceptNextStepId: 'thanks',
          declineNextStepId: 'downsell',
          triggerRules: [],
          offer: { variantId: 'gid://shopify/ProductVariant/2', quantity: 1 },
        },
        {
          id: 'downsell',
          type: 'downsell',
          name: 'Downsell',
          enabled: true,
          acceptNextStepId: 'thanks',
          declineNextStepId: 'thanks',
          triggerRules: [{ field: 'country', operator: 'equals', values: ['us'] }],
          offer: { variantId: 'gid://shopify/ProductVariant/3', quantity: 1 },
        },
        { id: 'thanks', type: 'thank_you', name: 'Thanks', enabled: true, triggerRules: [] },
      ],
    }],
  };
}

describe('funnel configuration', () => {
  it('migrates a legacy upsell into a published step graph', () => {
    const migrated = createLegacyDefaultFunnel('gid://shopify/ProductVariant/9');
    const version = migrated.versions[0];
    expect(version.status).toBe('published');
    expect(version.steps.map((step) => step.type)).toEqual(['checkout', 'upsell', 'thank_you']);
    expect(firstPostPurchaseStep(version)?.offer?.variantId).toContain('/9');
  });

  it('selects the highest-priority matching zone', () => {
    const funnels = normalizeFunnelConfigs([funnel('default'), funnel('us')]);
    const zones = normalizeCheckoutZones([
      { id: 'fallback', enabled: true, priority: 0, routes: [{ id: 'fallback-route', funnelId: 'default', weight: 100 }] },
      { id: 'us-zone', enabled: true, priority: 10, countries: ['US'], routes: [{ id: 'us-route', funnelId: 'us', weight: 100 }] },
    ]);
    expect(selectFunnel({ zones, funnels, cid: 'buyer', country: 'US', currency: 'USD' }).zoneId).toBe('us-zone');
  });

  it('keeps weighted route assignment stable and distributes traffic', () => {
    const funnels = normalizeFunnelConfigs([funnel('a'), funnel('b')]);
    const zones = normalizeCheckoutZones([{
      id: 'global',
      enabled: true,
      routes: [
        { id: 'route-a', funnelId: 'a', weight: 50 },
        { id: 'route-b', funnelId: 'b', weight: 50 },
      ],
    }]);
    const first = selectFunnel({ zones, funnels, cid: 'same-buyer' });
    expect(selectFunnel({ zones, funnels, cid: 'same-buyer' }).routeId).toBe(first.routeId);
    const assigned = new Set(Array.from({ length: 200 }, (_, index) => (
      selectFunnel({ zones, funnels, cid: `buyer-${index}` }).routeId
    )));
    expect(assigned).toEqual(new Set(['route-a', 'route-b']));
  });

  it('honors a permalink route and freezes the published version', () => {
    const funnels = normalizeFunnelConfigs([funnel('a'), funnel('b')]);
    const zones = normalizeCheckoutZones([{
      id: 'global',
      routes: [
        { id: 'route-a', funnelId: 'a', weight: 100 },
        { id: 'permalink-b', funnelId: 'b', weight: 0 },
      ],
    }]);
    const selected = selectFunnel({ zones, funnels, cid: 'buyer', permalinkRouteId: 'permalink-b' });
    expect(selected).toMatchObject({ routeId: 'permalink-b', funnelId: 'b', funnelVersionId: 'b-v1' });
  });

  it('routes accept and decline decisions and skips unmatched trigger steps', () => {
    const normalized = normalizeFunnelConfigs([funnel('a')]);
    const version = findFunnelVersion(normalized, 'a', 'a-v1');
    expect(version).toBeDefined();
    expect(nextFunnelStep({ version: version!, currentStepId: 'offer', decision: 'accepted' })?.id).toBe('thanks');
    expect(nextFunnelStep({ version: version!, currentStepId: 'offer', decision: 'declined', context: { country: 'US' } })?.id).toBe('downsell');
    expect(nextFunnelStep({ version: version!, currentStepId: 'offer', decision: 'declined', context: { country: 'CA' } })?.id).toBe('thanks');
  });
});
