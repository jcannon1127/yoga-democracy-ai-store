import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  plugins: [
    // Required: registers the /store/cybersource/authorize route the storefront
    // must call before placeOrder(). See yd-pay docs/payments-config.md.
    { resolve: 'medusa-payment-cybersource', options: {} },
  ],
  modules: [
    {
      // Password reset had no transport at all before this: the endpoint answered 201 and
      // the token was discarded. Provider id is config so yd-email can swap the local
      // (log-only) provider for a real one without touching a line of logic.
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [
          {
            resolve:
              process.env.NOTIFICATION_PROVIDER_RESOLVE ||
              '@medusajs/medusa/notification-local',
            id: process.env.NOTIFICATION_PROVIDER_ID || 'local',
            options: {
              name: 'Local Notification Provider',
              channels: [process.env.NOTIFICATION_EMAIL_CHANNEL || 'email'],
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            // PayPal — yd-pay fork, artifact dc4d37a. Identifier `paypal`.
            //
            // Two ways this differs from CyberSource, both of which have bitten:
            //  1. It has RUNTIME DEPENDENCIES (@paypal/paypal-server-sdk,
            //     libphonenumber-js) declared in apps/backend/package.json. Copying
            //     the provider alone gives MODULE_NOT_FOUND at first use.
            //  2. Its root barrel must re-export the provider. An earlier build's
            //     `main` exported {} — it RESOLVED fine and crashed module load with
            //     "moduleProviderServices is not iterable", taking the store down for
            //     6 minutes on 2026-08-24. rebuild.sh now gates on `services` being a
            //     non-empty array of constructibles, not on require() succeeding.
            //
            // Sandbox vs production is a CONFIG VALUE, never a code path. Live
            // credentials exist and are not to be used until Jeff approves.
            resolve: '@alphabite/medusa-paypal',
            id: process.env.PAYPAL_PROVIDER_ID || 'paypal',
            options: {
              clientId: process.env.PAYPAL_CLIENT_ID,
              clientSecret: process.env.PAYPAL_CLIENT_SECRET,
              // THE OPTION IS `isSandbox: boolean`, NOT `environment: string`.
              //
              // The provider's zod schema is `isSandbox: z.boolean().default(false)`
              // — so an unrecognised or missing option silently means PRODUCTION. On
              // 2026-08-24 I passed `environment: 'sandbox'`, it was ignored, and YD's
              // SANDBOX CREDENTIALS WERE SENT TO https://api-m.paypal.com — the live
              // PayPal API. The call failed on authentication so nothing moved, but
              // the default is live and that is the wrong way round.
              //
              // Written so the only way to reach production is to say so explicitly.
              isSandbox: process.env.PAYPAL_ENVIRONMENT !== 'production',
            },
          },
          {
            // Provider id is config, never a literal in logic. Sandbox vs
            // production is a flag, not a branch.
            resolve: 'medusa-payment-cybersource',
            id: process.env.PAYMENT_PROVIDER_ID || 'cybersource',
            options: {
              merchantID: process.env.CYBERSOURCE_MERCHANT_ID,
              merchantKeyId: process.env.CYBERSOURCE_KEY_ID,
              merchantsecretKey: process.env.CYBERSOURCE_SECRET_KEY,
              environment:
                process.env.CYBERSOURCE_ENV === 'production'
                  ? 'production'
                  : 'sandbox',
              capture: process.env.CYBERSOURCE_AUTO_CAPTURE === 'true',
            },
          },
        ],
      },
    },
  ],
})
