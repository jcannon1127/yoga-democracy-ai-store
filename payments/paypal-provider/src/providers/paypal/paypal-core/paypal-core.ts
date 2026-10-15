import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OAuthAuthorizationController,
  Order,
  OrderAuthorizeResponse,
  OrdersController,
  PaymentsController,
  Refund,
  Item,
  ShippingDetails,
  OrderApplicationContextShippingPreference,
  OrderApplicationContextUserAction,
  FulfillmentType,
} from "@paypal/paypal-server-sdk";
import { CartAddressDTO, CartLineItemDTO } from "@medusajs/framework/types";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AlphabitePaypalPluginOptionsType } from "../service";
import { MedusaError } from "@medusajs/framework/utils";

export interface PaypalCreateOrderInput {
  amount: number;
  currency: string;
  sessionId?: string;
  shipping_info?: CartAddressDTO;
  items?: CartLineItemDTO[];
  email?: string;
}

/**
 * PayPal requires a decimal string with at most 2 places for currencies that
 * support them. A raw `Number.toString()` fails on floating-point artefacts --
 * 20.700000000000003 is rejected with DECIMAL_PRECISION, which is a hard
 * checkout failure for that customer. Verified against the sandbox 2026-08-24:
 * "20", "20.1" and "20.00" are accepted; "20.005" and "0.30000000000000004"
 * return HTTP 422.
 */
export function money(value: unknown): string {
  let n: number

  if (typeof value === "object" && value !== null) {
    // Medusa v2 passes amounts as BigNumber, not a plain number. Its raw form is
    // { value: "27.01" } (sometimes `numeric`). Number(bigNumberObject) is NaN,
    // so this must be unwrapped before formatting -- caught by typechecking
    // against 2.19, which upstream (pinned to 2.13) never did.
    const raw = (value as { value?: unknown; numeric?: unknown })
    n = parseFloat(String(raw.value ?? raw.numeric))
  } else {
    n = typeof value === "number" ? value : Number(value)
  }

  if (!Number.isFinite(n)) {
    throw new Error(
      `PayPal: refusing to send a non-finite amount (${JSON.stringify(value)})`
    )
  }
  return n.toFixed(2)
}


export class PaypalService {
  private client: Client;
  private ordersController: OrdersController;
  private paymentsController: PaymentsController;
  private authController: OAuthAuthorizationController;
  private clientId: string;
  private clientSecret: string;
  private webhookId: string | undefined;
  private includeShippingData: boolean;
  private includeCustomerData: boolean;
  private baseUrl: string;

  constructor({
    clientId,
    clientSecret,
    isSandbox,
    webhookId,
    includeCustomerData,
    includeShippingData,
  }: AlphabitePaypalPluginOptionsType) {
    const environment = isSandbox
      ? Environment.Sandbox
      : Environment.Production;

    this.client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: clientId,
        oAuthClientSecret: clientSecret,
      },
      timeout: 0,
      environment,
      logging: {
        logLevel: LogLevel.Info,
        logRequest: {
          logBody: true,
        },
        logResponse: {
          logHeaders: true,
        },
      },
    });

    this.baseUrl = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.webhookId = webhookId;

    this.ordersController = new OrdersController(this.client);
    this.paymentsController = new PaymentsController(this.client);
    this.authController = new OAuthAuthorizationController(this.client);

    this.includeCustomerData = !!includeCustomerData;
    this.includeShippingData = !!includeShippingData;
  }

  async getAccessToken(): Promise<string> {
    try {
      const authorization = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString("base64");

      const authRes = await this.authController.requestToken({
        authorization: `Basic ${authorization}`,
      });

      const accessToken = authRes.result.accessToken;

      if (!accessToken) throw new Error("Failed to get access token");

      return accessToken;
    } catch (error) {
      throw new Error(`Failed to get access token: ${JSON.stringify(error)}`);
    }
  }

  async createOrder({
    amount,
    currency,
    sessionId,
    shipping_info,
    items,
    email,
  }: PaypalCreateOrderInput): Promise<Order> {
    const ordersController = new OrdersController(this.client);

    const paypalItems: Item[] =
      items?.map((item) => ({
        name: item.title,
        quantity: item.quantity.toString(),
        unitAmount: {
          currencyCode: currency,
          value: money(item.unit_price),
        },
      })) || [];

    const hasItems = paypalItems.length > 0;

    // Reconcile the breakdown before sending it. PayPal validates that
    // itemTotal + shipping (+ tax, handling, discount) equals the order amount,
    // to the cent.
    const itemTotal = (items || []).reduce(
      (sum, item) => sum + Number(money(item.unit_price)) * Number(item.quantity),
      0
    );
    const shippingRemainder = Number((Number(amount) - itemTotal).toFixed(2));
    const includeBreakdown = hasItems && shippingRemainder >= 0;

    const shippingData: ShippingDetails | false = !!shipping_info && {
      ...(this.includeCustomerData &&
        this.mapCustomerData({ email, shipping_info })),
      ...(this.includeShippingData && this.mapShippingData(shipping_info)),
      type: FulfillmentType.Shipping,
    };

    const createdOrder = await ordersController.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: {
              currencyCode: currency,
              value: money(amount),
              // itemTotal MUST equal the sum of (unit_amount x quantity), NOT the
              // order total. Upstream sent the order total, which PayPal rejects
              // with ITEM_TOTAL_MISMATCH on every order carrying shipping or tax
              // -- proven against the sandbox 2026-08-24. YD charges shipping
              // below $49, so that is most orders.
              //
              // We only send a breakdown when it reconciles exactly. If it does
              // not, we send the order total alone and drop the itemised detail:
              // losing line items in the PayPal UI is a cosmetic loss, while an
              // unreconciled breakdown is a hard checkout failure.
              ...(includeBreakdown && {
                breakdown: {
                  itemTotal: {
                    currencyCode: currency,
                    value: money(itemTotal),
                  },
                  ...(shippingRemainder > 0 && {
                    shipping: {
                      currencyCode: currency,
                      value: money(shippingRemainder),
                    },
                  }),
                },
              }),
            },
            customId: sessionId,
            ...(hasItems && { items: paypalItems }),
            ...(shippingData && { shipping: shippingData }),
          },
        ],
        applicationContext: {
          ...(this.includeShippingData &&
            shippingData && {
              shippingPreference:
                OrderApplicationContextShippingPreference.SetProvidedAddress,
            }),
          userAction: OrderApplicationContextUserAction.PayNow,
        },
      },
    });

    if (!createdOrder?.result?.id) throw new Error("Failed to create order");

    return createdOrder.result;
  }

  async captureOrder(id: string): Promise<Order> {
    const capturedOrder = await this.ordersController.captureOrder({
      id,
    });

    return capturedOrder.result;
  }

  async retrieveOrder(id: string): Promise<Order> {
    const orderDetails = await this.ordersController.getOrder({
      id,
    });

    return orderDetails.result;
  }

  async authorizeOrder(id: string): Promise<OrderAuthorizeResponse> {
    const authorizedOrder = await this.ordersController.authorizeOrder({
      id,
    });

    return authorizedOrder.result;
  }

  /**
   * Refund captures, for a SPECIFIC amount when one is given.
   *
   * PAYPAL TREATS A REFUND WITH NO BODY AS A FULL REFUND. Upstream called
   * `refundCapturedPayment({ captureId })` with nothing else, so **every refund
   * returned the entire capture** no matter what Medusa had been asked for.
   *
   * Proven on 2026-08-26 before this was written: a $10 refund on a $75 order
   * gave the customer $75.00 back at PayPal (refund 35N49397GK419322S,
   * capture REFUNDED) while Medusa recorded $10. **$65 given away, silently, and
   * the books disagreed with the money.**
   */
  async refundPayment(
    captureIds: string[],
    amount?: { value: string; currencyCode: string }
  ): Promise<Refund[]> {
    const refunds: Refund[] = [];

    for (const captureId of captureIds) {
      const refund = await this.paymentsController.refundCapturedPayment({
        captureId,
        ...(amount
          ? { body: { amount: { value: amount.value, currencyCode: amount.currencyCode } } }
          : {}),
      });

      refunds.push(refund.result);
    }

    return refunds;
  }

  public verifyWebhook = async ({
    headers,
    body,
  }: {
    headers: Record<string, string>;
    body: object;
  }): Promise<{ body: object; status: "SUCCESS" | "FAILURE" }> => {
    if (!this.webhookId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Webhook ID is not set",
      );
    }

    const accessToken = await this.getAccessToken();

    const verifyWebhookRes = await fetch(
      `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: this.webhookId,
          webhook_event: body,
        }),
      },
    );

    if (!verifyWebhookRes.ok) {
      throw new Error(
        `Failed to verify webhook signature: ${verifyWebhookRes.statusText}`,
      );
    }

    const verifyWebhookData = await verifyWebhookRes.json();

    if (verifyWebhookData.verification_status !== "SUCCESS") {
      throw new Error("Failed to verify webhook signature");
    }

    return { status: verifyWebhookData.verification_status, body };
  };

  private mapCustomerData({
    email,
    shipping_info,
  }: {
    email?: string;
    shipping_info: PaypalCreateOrderInput["shipping_info"];
  }):
    | Pick<ShippingDetails, "name" | "emailAddress" | "phoneNumber">
    | undefined {
    if (!this.includeCustomerData || !shipping_info) {
      return undefined;
    }

    const parsedPhoneNumber =
      !!shipping_info?.phone && parsePhoneNumberFromString(shipping_info.phone);

    return {
      name: {
        fullName: `${shipping_info.first_name} ${shipping_info.last_name}`,
      },
      ...(email && { emailAddress: email }),
      ...(parsedPhoneNumber && {
        phoneNumber: {
          countryCode: parsedPhoneNumber.countryCallingCode,
          nationalNumber: parsedPhoneNumber.nationalNumber,
        },
      }),
    };
  }

  private mapShippingData(
    shipping_info: PaypalCreateOrderInput["shipping_info"],
  ): Pick<ShippingDetails, "address"> | undefined {
    if (
      !this.includeShippingData ||
      !shipping_info ||
      !shipping_info.country_code
    ) {
      return undefined;
    }

    return {
      address: {
        countryCode: shipping_info.country_code,
        postalCode: shipping_info.postal_code,
        adminArea1: shipping_info.province,
        adminArea2: shipping_info.city,
        addressLine1: shipping_info.address_1,
      },
    };
  }
}
