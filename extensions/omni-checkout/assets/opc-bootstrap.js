(function () {
  "use strict";

  var proxyPrefix = "/a/s";

  function clientId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function sourceParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      source: params.get("utm_source") || "",
      campaign: params.get("utm_campaign") || "",
      medium: params.get("utm_medium") || "",
      content: params.get("utm_content") || "",
      term: params.get("utm_term") || ""
    };
  }

  function shopDomain() {
    return window.Shopify && (window.Shopify.shop || window.Shopify.shopOrigin) || window.location.hostname;
  }

  function navigate(path) {
    window.location.assign(new URL(path, window.location.origin).toString());
  }

  function productVariant(form) {
    var input = form && form.querySelector('[name="id"]');
    return input ? String(input.value || "") : "";
  }

  function quantity(form) {
    var input = form && form.querySelector('[name="quantity"]');
    var value = input ? parseInt(input.value, 10) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function request(path, body) {
    return fetch(proxyPrefix + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (json) {
        if (!response.ok) throw new Error(json.error || "Checkout request failed");
        return json;
      });
    });
  }

  function cartItems() {
    return fetch("/cart.js", { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("Unable to read cart contents");
      return response.json();
    }).then(function (cart) {
      var items = Array.isArray(cart && cart.items) ? cart.items : [];
      return items.map(function (item) {
        return {
          variantId: "gid://shopify/ProductVariant/" + String(item.variant_id || ""),
          quantity: Number(item.quantity || 0)
        };
      }).filter(function (item) {
        return item.variantId !== "gid://shopify/ProductVariant/" && Number.isInteger(item.quantity) && item.quantity > 0;
      });
    });
  }

  function start(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    var button = event && event.currentTarget;
    var form = button && button.closest("form") || document.querySelector('form[action*="/cart/add"]');
    var variant = productVariant(form);
    var originalText = button && button.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Loading checkout...";
    }
    var cid = clientId();
    var payload = {
      shopDomain: shopDomain(),
      cid: cid,
      currency: window.Shopify && window.Shopify.currency ? window.Shopify.currency.active : "USD",
      utm: sourceParams()
    };
    var itemsPromise = variant
      ? Promise.resolve([{ variantId: "gid://shopify/ProductVariant/" + variant, quantity: quantity(form) }])
      : cartItems();
    itemsPromise.then(function (items) {
      if (!items.length) throw new Error("Your cart is empty");
      return request("/api/checkout/session", Object.assign(payload, { items: items }));
    }).then(function (session) {
      navigate(session.redirectUrl);
    }).catch(function (error) {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || "Buy it now";
      }
      window.alert(error.message);
    });
  }

  function wire() {
    [
      ".shopify-payment-button__button",
      'button[name="checkout"]',
      '[data-shopify="payment-button"] button'
    ].forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (button) {
        if (button.dataset.omniCheckoutWired === "true") return;
        button.dataset.omniCheckoutWired = "true";
        button.addEventListener("click", start, true);
      });
    });
  }

  window.omniCheckout = start;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true });
})();
