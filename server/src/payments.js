"use strict";

/* Payment provider. Stripe Checkout when it is configured; otherwise a local
   stand-in that mimics the same redirect-out / redirect-back flow so the rest
   of the app has exactly one code path. The stand-in refuses to start unless
   ALLOW_DEV_PAYMENTS is set, so a misconfigured production box takes no bids
   rather than giving spots away free. */

function createPayments(config) {
  if (config.stripeSecretKey) {
    const Stripe = require("stripe");
    const stripe = new Stripe(config.stripeSecretKey, { apiVersion: "2024-06-20" });

    return {
      mode: "stripe",
      webhookConfigured: !!config.stripeWebhookSecret,

      async createCheckout(opts) {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          client_reference_id: opts.bid.id,
          customer_email: opts.bid.email || undefined,
          metadata: { bidId: opts.bid.id, listingKey: opts.bid.listing_key, board: opts.bid.board },
          payment_intent_data: {
            metadata: { bidId: opts.bid.id, listingKey: opts.bid.listing_key },
            description: "outdeals bid — " + opts.description
          },
          line_items: [{
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: opts.bid.charge * 100,
              product_data: {
                name: opts.productName,
                description: opts.description
              }
            }
          }],
          expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
          success_url: opts.successUrl,
          cancel_url: opts.cancelUrl
        }, { idempotencyKey: "checkout_" + opts.bid.id });
        return { url: session.url, sessionId: session.id };
      },

      async refund(paymentIntent, reason) {
        if (!paymentIntent) return { ok: false, error: "no payment intent" };
        const r = await stripe.refunds.create(
          { payment_intent: paymentIntent, reason: "requested_by_customer", metadata: { reason: reason || "" } },
          { idempotencyKey: "refund_" + paymentIntent }
        );
        return { ok: true, id: r.id };
      },

      verifyWebhook(rawBody, signature) {
        if (!config.stripeWebhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
        return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
      }
    };
  }

  if (config.allowDevPayments) {
    return {
      mode: "dev",
      webhookConfigured: false,

      async createCheckout(opts) {
        const sessionId = "devsess_" + opts.bid.id;
        return { url: config.apiBaseUrl + "/api/dev/checkout/" + opts.bid.id, sessionId };
      },

      async refund() { return { ok: true, id: "dev_refund" }; },

      verifyWebhook() { throw new Error("dev payments have no webhook"); }
    };
  }

  return {
    mode: "disabled",
    webhookConfigured: false,
    async createCheckout() {
      const err = new Error("Payments are not configured on this server.");
      err.status = 503;
      throw err;
    },
    async refund() { return { ok: false, error: "payments disabled" }; },
    verifyWebhook() { throw new Error("payments disabled"); }
  };
}

module.exports = { createPayments };
