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

  function variantId(form) {
    var input = form && form.querySelector('[name="id"]');
    return input ? input.value : "";
  }

  function quantity(form) {
    var input = form && form.querySelector('[name="quantity"]');
    var value = input ? parseInt(input.value, 10) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
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

  async function cartItems() {
    var response = await fetch("/cart.js", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Unable to read cart contents");
    var cart = await response.json();
    return (Array.isArray(cart && cart.items) ? cart.items : []).map(function (item) {
      return {
        variantId: "gid://shopify/ProductVariant/" + String(item.variant_id || ""),
        quantity: Number(item.quantity || 0)
      };
    }).filter(function (item) {
      return item.variantId !== "gid://shopify/ProductVariant/" && Number.isInteger(item.quantity) && item.quantity > 0;
    });
  }

  function shopDomain() {
    return (
      window.Shopify && (window.Shopify.shop || window.Shopify.shopOrigin) ||
      window.location.hostname
    );
  }

  function navigate(path) {
    window.location.assign(new URL(path, window.location.origin).toString());
  }

  async function startCheckout(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }

    var button = event && event.currentTarget;
    var form = button
      ? button.closest('form[action*="/cart/add"], form[action="/cart/add"]')
      : document.querySelector('form[action*="/cart/add"], form[action="/cart/add"]');
    var variant = variantId(form);

    var originalText = button && button.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Loading checkout...";
    }

    try {
      var clientId = cid();
      var items = variant
        ? [{ variantId: "gid://shopify/ProductVariant/" + variant, quantity: quantity(form) }]
        : await cartItems();
      if (!items.length) throw new Error("Your cart is empty");
      var session = await post("/api/checkout/session", {
        shopDomain: shopDomain(),
        cid: clientId,
        items: items,
        currency: window.Shopify && window.Shopify.currency ? window.Shopify.currency.active : "USD",
        utm: utm()
      });
      navigate(session.redirectUrl || (appProxyPrefix + "/checkout/" + encodeURIComponent(session.sessionId) + "/entry?cid=" + encodeURIComponent(session.cid || clientId)));
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
