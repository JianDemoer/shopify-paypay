(function () {
  "use strict";

  var appProxyPrefix = "/a/s";
  var apiBase = appProxyPrefix;

  function cid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function utm() {
    var params = new URLSearchParams(window.location.search);
    return {
      source: params.get("utm_source") || "",
      campaign: params.get("utm_campaign") || "",
      medium: params.get("utm_medium") || "",
      content: params.get("utm_content") || "",
      term: params.get("utm_term") || ""
    };
  }

  function productTitle(form) {
    var heading = document.querySelector("h1");
    var button = form && form.querySelector("button");
    return (heading && heading.textContent || button && button.textContent || "Shopify product").trim();
  }

  function variantId(form) {
    var input = form && form.querySelector('[name="id"]');
    return input ? input.value : "";
  }

  function quantity(form) {
    var input = form && form.querySelector('[name="quantity"]');
    var value = input ? parseInt(input.value, 10) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function price() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
    var selectedVariant = meta && meta.selectedVariantId;
    var product = meta && meta.product;
    if (product && product.variants && selectedVariant) {
      var variant = product.variants.find(function (item) { return String(item.id) === String(selectedVariant); });
      if (variant && variant.price) return Number(variant.price) / 100;
    }
    return 0;
  }

  async function post(path, body) {
    var response = await fetch(apiBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    var json = await response.json();
    if (!response.ok) throw new Error(json.error || "Checkout request failed");
    return json;
  }

  function shopDomain() {
    return (
      window.Shopify && (window.Shopify.shop || window.Shopify.shopOrigin) ||
      window.location.hostname
    );
  }

  async function startCheckout(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    var button = event && event.currentTarget;
    var form = button
      ? button.closest('form[action*="/cart/add"], form[action="/cart/add"]')
      : document.querySelector('form[action*="/cart/add"], form[action="/cart/add"]');
    var variant = variantId(form);

    if (!variant) {
      window.location.href = "/checkout";
      return;
    }

    var originalText = button && button.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Loading checkout...";
    }

    try {
      var clientId = cid();
      var session = await post("/api/checkout/session", {
        shopDomain: shopDomain(),
        cid: clientId,
        productId: window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product
          ? "gid://shopify/Product/" + window.ShopifyAnalytics.meta.product.id
          : "",
        variantId: "gid://shopify/ProductVariant/" + variant,
        title: productTitle(form),
        quantity: quantity(form),
        price: price(),
        currency: window.Shopify && window.Shopify.currency ? window.Shopify.currency.active : "USD",
        utm: utm()
      });
      window.location.href = session.redirectUrl || (appProxyPrefix + "/checkout/" + encodeURIComponent(session.sessionId) + "/entry?cid=" + encodeURIComponent(session.cid || clientId));
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || "Buy it now";
      }
      window.alert(error.message);
    }
  }

  function wireButtons() {
    [
      ".shopify-payment-button__button",
      'button[name="checkout"]',
      '[data-shopify="payment-button"] button'
    ].forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (button) {
        if (button.dataset.opcWired === "true") return;
        button.dataset.opcWired = "true";
        button.id = button.id || "opc-override-dyn-c-btn";
        button.addEventListener("click", startCheckout, true);
      });
    });
  }

  window.opc_app_proxy_prefix = appProxyPrefix;
  window.opc_checkout_api_url = apiBase;
  window.itcProdPageCheckout = startCheckout;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireButtons);
  } else {
    wireButtons();
  }
  new MutationObserver(wireButtons).observe(document.documentElement, { childList: true, subtree: true });
})();
