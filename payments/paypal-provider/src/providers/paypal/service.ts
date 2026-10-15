import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentSessionStatus,
} from "@medusajs/framework/utils";
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  RefundPaymentInput,
  RefundPaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types";
import { CaptureStatus, Order } from "@paypal/paypal-server-sdk";
import { WebhookPayload } from "./types";
import { money, PaypalCreateOrderInput, PaypalService } from "./paypal-core";
import { z } from "zod";

export interface PaypalPaymentError {
  code: string;
  message: string;
  retryable: boolean;
  avsCode?: string;
  cvvCode?: string;
}

/** Sentinel id for a basket fully covered by a discount, which never reaches
 *  PayPal. Mirrors the CyberSource provider's FREE_ORDER marker. */
const FREE_ORDER_ID = "FREE_ORDER";

/**
 * Provider options.
 *
 * TWO DELIBERATE DIVERGENCES FROM UPSTREAM, both about the same hazard: on
 * 2026-08-24 YD's SANDBOX credentials were sent to `https://api-m.paypal.com`,
 * the LIVE PayPal API. Nothing moved, because the credentials failed to
 * authenticate there. But the reason it happened is the dangerous part.
 *
 *   1. `isSandbox` defaulted to FALSE, so the default was PRODUCTION.
 *   2. The schema was non-strict, so zod silently STRIPPED the unknown key
 *      `environment: "sandbox"` that had been passed instead. A wrong option
 *      name meant live, with no error anywhere.
 *
 * "A missing input must never become a permissive answer" -- in the most
 * expensive place available. So:
 *
 *   - `isSandbox` now defaults to TRUE. Reaching production requires saying so.
 *   - `.strict()` makes an unrecognised option a loud failure, not silent live.
 *   - `environment` is rejected by name, because it is what CyberSource takes and
 *      is therefore the mistake anyone reusing that recipe will make.
 */
const optionsSchema = z
  .object({
    clientId: z
      .string()
      .min(1, "PayPal client ID is required")
      .describe(
        "PayPal client ID used for authentication. This field is required."
      ),
    clientSecret: z.string().min(1, "PayPal client secret is required"),
    isSandbox: z
      .boolean()
      .default(true)
      .describe(
        "Defaults to TRUE (sandbox). Production must be requested explicitly."
      ),
    webhookId: z.string().optional(),
    includeShippingData: z.boolean().default(false),
    includeCustomerData: z.boolean().default(false),
  })
  .strict()
  .superRefine((opts, ctx) => {
    if ("environment" in (opts as Record<string, unknown>)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "PayPal takes `isSandbox: boolean`, not `environment: string`. " +
          "`environment` is the CyberSource option name; passing it here would " +
          "previously have been ignored and defaulted to LIVE.",
      });
    }
  });

export type AlphabitePaypalPluginOptionsType = z.infer<typeof optionsSchema>;

export type AlphabitePaypalPluginOptions = {
  /**
   * PayPal client ID used for authentication.
   * This field is required.
   */
  clientId: string;

  /**
   * PayPal client secret used for authentication.
   * This field is required.
   */
  clientSecret: string;

  /**
   * Whether to use PayPal’s sandbox environment for testing.
   * Default: false
   */
  isSandbox?: boolean;

  /**
   * PayPal webhook ID to validate incoming webhooks.
   * Optional.
   */
  webhookId?: string;

  /**
   * Whether to include shipping data in transactions and responses.
   * Default: false
   */
  includeShippingData?: boolean;

  /**
   * Whether to include customer data (e.g., name, email) in transactions and responses.
   * Default: false
   */
  includeCustomerData?: boolean;
};

type InjectedDependencies = {
  logger: Logger;
  paymentModuleService: any;
};

interface InitiatePaymentInputCustom
  extends Omit<InitiatePaymentInput, "data"> {
  data?: Pick<PaypalCreateOrderInput, "items" | "shipping_info" | "email">;
}

interface AuthorizePaymentInputData
  extends Pick<PaypalCreateOrderInput, "items" | "shipping_info" | "email"> {}

export default class PaypalModuleService extends AbstractPaymentProvider<AlphabitePaypalPluginOptionsType> {
  static identifier = "paypal";

  protected client: PaypalService;
  protected logger: Logger;
  protected paymentModuleService: any;

  constructor(
    container: InjectedDependencies,
    private readonly options: AlphabitePaypalPluginOptionsType
  ) {
    super(container, options);

    this.logger = container.logger;
    this.paymentModuleService = container.paymentModuleService;

    // Parse the options rather than using them raw. Upstream validated with
    // `safeParse` and DISCARDED the result, then handed the raw object to the
    // client -- so every schema default was decorative. `isSandbox` in
    // particular never received its default, and an omitted value meant
    // `undefined`, which is falsy, which is PRODUCTION.
    //
    // Found because a test asserted the resulting HOST rather than the input.
    // An earlier version of that test checked the option value and passed while
    // the provider still talked to https://api-m.paypal.com.
    const parsed = optionsSchema.parse(options);
    this.client = new PaypalService(parsed);
  }

  static validateOptions(options: AlphabitePaypalPluginOptionsType): void {
    const result = optionsSchema.safeParse(options);

    if (!result.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid PayPal plugin options: ${result.error.message}`
      );
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    try {
      if (!input.data) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Payment data is required"
        );
      }

      if (!input.data.id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "PayPal order ID is required to capture payment"
        );
      }

      if (
        input.data.status === PaymentSessionStatus.CAPTURED ||
        input.data.status === "COMPLETED"
      ) {
        return {
          data: {
            ...input.data,
            status: PaymentSessionStatus.CAPTURED,
            captured_at: new Date().toISOString(),
          },
        };
      }

      const id = input.data.id as string;

      await this.client.captureOrder(id);

      return {
        data: {
          ...input.data,
          status: PaymentSessionStatus.CAPTURED,
          captured_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("PayPal capture payment error:", error);

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Failed to capture PayPal payment"
      );
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    if (!input.data) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment data is required"
      );
    }

    const data = input.data as unknown as AuthorizePaymentInputData | undefined;

    let paypalData = input.data as Order | undefined;

    const amount = input.data.amount as number;
    const currencyCode = input.data.currency_code as string;
    const orderId = paypalData?.id as string;

    // A fully-discounted basket never went to PayPal, so there is nothing to
    // capture and no order id to capture it with. Authorize it locally.
    if ((input.data as Record<string, unknown>)?.free_order === true ||
        orderId === FREE_ORDER_ID) {
      return { status: "captured" as const, data: input.data };
    }

    if (!orderId || amount == null || !currencyCode) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal order ID, Amount or Currency is missing, can not capture order."
      );
    }

    const isAuthorized =
      paypalData?.purchaseUnits?.[0].payments?.captures?.[0]?.status ===
      CaptureStatus.Completed;

    if (!isAuthorized) {
      try {
        paypalData = await this.client.captureOrder(orderId);
      } catch (err) {
        const body = JSON.parse(err?.body || "{}");

        const captureData = body?.purchase_units?.[0]?.payments?.captures?.[0];

        const newOrder = await this.client.createOrder({
          amount: Number(amount),
          currency: currencyCode,
          sessionId: input.context?.idempotency_key,
          items: data?.items,
          shipping_info: data?.shipping_info,
          email: data?.email,
        });

        if (!captureData) {
          const error: PaypalPaymentError = {
            code: "404",
            message:
              "Payment declined. Please try again or use a different card.",
            retryable: true,
          };

          return {
            status: PaymentSessionStatus.PENDING,
            data: {
              ...input.data,
              ...newOrder,
              error,
            },
          };
        }

        const paymentStatus = captureData?.status || CaptureStatus.Declined;
        const processorResponse = captureData?.processorResponse;

        const { error = undefined } = this.checkPaymentStatus(
          paymentStatus,
          processorResponse
        );

        return {
          status: PaymentSessionStatus.PENDING,
          data: {
            ...input.data,
            ...newOrder,
            error,
          },
        };
      }

      const captureData = paypalData.purchaseUnits?.[0].payments?.captures?.[0];

      const paymentStatus = captureData?.status || CaptureStatus.Declined;
      const processorResponse = captureData?.processorResponse;

      const { status, error = undefined } = this.checkPaymentStatus(
        paymentStatus,
        processorResponse
      );

      if (status === CaptureStatus.Declined) {
        const newOrder = await this.client.createOrder({
          amount: Number(captureData?.amount?.value),
          currency: captureData?.amount?.currencyCode!,
          sessionId: input.context?.idempotency_key,
          items: data?.items,
          shipping_info: data?.shipping_info,
          email: data?.email,
        });

        return {
          status: PaymentSessionStatus.PENDING,
          data: {
            ...input.data,
            ...newOrder,
            error,
          },
        };
      }
    }

    // PayPal orders are created with `intent: CAPTURE` (paypal-core.ts), so
    // reaching this line means THE MONEY IS ALREADY SETTLED -- either
    // `captureOrder()` just ran above, or the order arrived carrying a COMPLETED
    // capture. Upstream returned AUTHORIZED here regardless.
    //
    // WHAT THAT COST, measured on two real sandbox purchases on 2026-08-25:
    //   PayPal        capture COMPLETED, finalCapture: true, money taken
    //   Medusa        payment_collection `authorized`, captured_at NULL,
    //                 ZERO rows in `capture`
    // Nothing errors. The order sits `pending` against money the customer has
    // already paid, and settlement reconciles it as unpaid revenue.
    //
    // Returning CAPTURED is not a cosmetic status change: Medusa's payment
    // module (`authorizePaymentSession_`) treats it as authorize-then-capture and
    // writes the capture row itself with `is_captured: true`, so the provider is
    // NOT called a second time and the money cannot be taken twice. Checked in
    // @medusajs/payment 2.19 rather than inferred from the name.
    //
    // Derived from the capture, not asserted: an order that somehow has no
    // completed capture still reports AUTHORIZED, which is the truth for it.
    const settled =
      paypalData?.purchaseUnits?.[0]?.payments?.captures?.[0]?.status ===
      CaptureStatus.Completed;

    return {
      data: {
        ...paypalData,
      },
      status: settled
        ? PaymentSessionStatus.CAPTURED
        : PaymentSessionStatus.AUTHORIZED,
    };
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    try {
      if (!input.data) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Payment data is required"
        );
      }

      const orderId = input.data["id"] as string;

      if (!orderId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Cancel payment failed! PayPal order ID and capture ID is required to cancel payment"
        );
      }

      return {
        data: {
          order_id: orderId,
          status: PaymentSessionStatus.CANCELED,
          cancelled_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("PayPal cancel payment error:", error);

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Failed to cancel PayPal payment"
      );
    }
  }

  async initiatePayment(
    input: InitiatePaymentInputCustom
  ): Promise<InitiatePaymentOutput> {
    try {
      if (!input.data) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Payment data is required"
        );
      }

      const { amount, currency_code, context, data } = input;

      // NOTE the order of these checks. `!amount` is true for 0, so upstream
      // rejected a legitimate free order with "Amount and currency code are
      // required" -- a misleading error, and a broken checkout, for any 100%-off
      // coupon. YD has at least two live codes that discount 100%
      // (`yoga100`, `Evolve50`), so this is reachable today.
      if (currency_code == null || amount == null) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Amount and currency code are required"
        );
      }

      // PayPal REFUSES a zero-amount order: CANNOT_BE_ZERO_OR_NEGATIVE, HTTP 422
      // (verified against the sandbox 2026-08-24; 0.01 is accepted, 0.00 is not).
      // So a fully-discounted basket must never reach PayPal at all. Mark it
      // authorized locally and let the order complete, exactly as the CyberSource
      // provider does for the same reason.
      if (Number(amount) <= 0) {
        return {
          id: FREE_ORDER_ID,
          data: { ...data, ...context, amount, currency_code, free_order: true },
        };
      }

      const order = await this.client.createOrder({
        amount: Number(amount),
        currency: currency_code,
        sessionId: context?.idempotency_key,
        items: data?.items,
        shipping_info: data?.shipping_info,
        email: data?.email,
      });

      return {
        data: { ...data, ...order, ...context, amount, currency_code },

        id: order.id!,
      };
    } catch (error) {
      this.logger.error("PayPal initiate payment error:", error);
      throw error;
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    try {
      if (!input.data) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Payment data is required"
        );
      }

      const orderId = input.data["id"] as string;
      const purchaseUnits =
        (input?.data?.["purchaseUnits"] as Order["purchaseUnits"]) || [];

      const captureIds = purchaseUnits
        ?.flatMap((item) =>
          item?.payments?.captures?.map((capture) => capture.id)
        )
        .filter((id) => id !== undefined);

      if (!orderId || !captureIds) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Refund payment failed! PayPal order ID and capture ID is required to cancel payment"
        );
      }

      // THE AMOUNT MUST BE SENT. Without it PayPal refunds the whole capture --
      // see the note on client.refundPayment. `money()` unwraps Medusa's
      // BigNumber and fixes the precision PayPal requires.
      const requested = (input as { amount?: unknown }).amount;
      const currency =
        ((input.data?.["currency_code"] as string) ||
          (input.data?.["currencyCode"] as string) ||
          "USD").toUpperCase();

      if (requested != null && captureIds.length > 1) {
        // Splitting one amount across several captures is a guess, and a wrong
        // guess moves money. Refuse instead.
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Cannot refund a specific amount across ${captureIds.length} captures. Refund each capture individually.`
        );
      }

      await this.client.refundPayment(
        captureIds as string[],
        requested != null
          ? { value: money(requested), currencyCode: currency }
          : undefined
      );

      return {
        data: {
          order_id: orderId,
          status: PaymentSessionStatus.CANCELED,
          cancelled_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("PayPal refund payment error:", error);

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Failed to refund PayPal payment"
      );
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    try {
      if (!input.data) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Payment data is required"
        );
      }

      const orderId = input.data["id"] as string;

      if (!orderId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Delete payment failed! PayPal order ID and capture ID is required to cancel payment"
        );
      }

      return {
        data: {
          order_id: orderId,
          status: PaymentSessionStatus.CANCELED,
          cancelled_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("PayPal cancel payment error:", error);
      throw error;
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    try {
      if (!input.data) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Payment data is required"
        );
      }

      const order_id = input.data["id"] as string;

      if (!order_id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "PayPal order ID is required to cancel payment"
        );
      }

      const order = await this.client.retrieveOrder(order_id);

      if (!order || !order.status) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `PayPal order with ID ${order_id} not found`
        );
      }

      return {
        status:
          order.status === "COMPLETED"
            ? PaymentSessionStatus.CAPTURED
            : PaymentSessionStatus.AUTHORIZED,
      };
    } catch (error) {
      this.logger.error("PayPal get payment status error:", error);
      throw error;
    }
  }

  async retrievePayment(input: Record<string, unknown>) {
    try {
      const id = input["id"] as string;

      const res = await this.client.retrieveOrder(id);
      return {
        data: { response: res },
      };
    } catch (error) {
      this.logger.error("PayPal retrieve payment error:", error);
      throw error;
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Not implemented");
  }

  async getWebhookActionAndData(
    payload: WebhookPayload
  ): Promise<WebhookActionResult> {
    try {
      const { data, headers } = payload;

      await this.client.verifyWebhook({ headers, body: data });

      switch (data.event_type) {
        case "PAYMENT.CAPTURE.COMPLETED":
          return {
            action: "captured",
            data: {
              session_id: data.resource.custom_id,
              amount: Number(data.resource.amount.value),
            },
          };
        default:
          return {
            action: "not_supported",
          };
      }
    } catch (e) {
      // A WEBHOOK WE CANNOT VERIFY IS NOT EVIDENCE THAT A PAYMENT FAILED.
      //
      // Upstream returned `action: "failed"` here, and this branch is reached by
      // EVERY unverifiable payload -- including every payload at all while
      // `webhookId` is unset, which is its current state. So the one path that
      // exists to reject a forged or unverified webhook was reporting a verdict
      // about the customer's payment, taken from the forged payload's own
      // `custom_id`. "I could not check" turned into "it failed", which is the
      // same inversion as a reconciler reporting a clean run when it could not
      // look.
      //
      // Measured 2026-08-26 before changing it: an unauthenticated
      // PAYMENT.CAPTURE.COMPLETED naming a real pending session did NOT change
      // that session, so it was not exploitable as it stood. The posture is
      // still wrong, and it becomes exploitable the moment Medusa acts on
      // "failed" for a session in a different state.
      //
      // `not_supported` is the honest answer: make no claim.
      this.logger.error(
        `PayPal webhook rejected (${(e as Error)?.message ?? e}). event_type=` +
          `${(payload?.data as { event_type?: string })?.event_type ?? "unknown"}. ` +
          `No payment state was changed. If webhookId is unset, EVERY webhook lands here.`
      );
      return { action: "not_supported" };
    }
  }

  private checkPaymentStatus(
    status: CaptureStatus,
    processorResponse?: {
      avsCode?: string;
      cvvCode?: string;
      responseCode?: string;
    }
  ): { status: CaptureStatus; error?: PaypalPaymentError } {
    const processorResponseMap: Record<string, PaypalPaymentError> = {
      "0500": {
        code: "0500 - DO_NOT_HONOR",
        message:
          "Card refused by issuer. Please try again or use a different card.",
        retryable: false,
      },
      "9500": {
        code: "9500 - SUSPECTED_FRAUD",
        message:
          "Suspected fraudulent card. Please try again and use a different card.",
        retryable: false,
      },
      "5400": {
        code: "5400 - EXPIRED_CARD",
        message: "Card has expired. Please try again and use a different card.",
        retryable: false,
      },
      "5120": {
        code: "5120 - INSUFFICIENT_FUNDS",
        message:
          "Insufficient funds. Please try again or use a different card.",
        retryable: true,
      },
      "00N7": {
        code: "00N7 - CVV_FAILURE",
        message:
          "Incorrect security code. Please try again or use a different card.",
        retryable: true,
      },
      "1330": {
        code: "1330 - INVALID_ACCOUNT",
        message: "Card not valid. Please try again or use a different card.",
        retryable: true,
      },
      "5100": {
        code: "5100 - GENERIC_DECLINE",
        message: "Card is declined. Please try again or use a different card.",
        retryable: true,
      },
    };

    switch (status) {
      case "COMPLETED":
        return { status };

      case "DECLINED":
        if (processorResponse?.responseCode) {
          const errorDetails = processorResponseMap[
            processorResponse.responseCode
          ] || {
            code: processorResponse.responseCode,
            message:
              "Payment declined. Please try again or use a different card.",
            retryable: false,
          };

          return {
            status,
            error: {
              ...errorDetails,
              avsCode: processorResponse.avsCode,
              cvvCode: processorResponse.cvvCode,
            },
          };
        }

        return {
          status,
          error: {
            code: "DECLINED",
            message:
              "Payment declined. Please try again or use a different card.",
            retryable: false,
          },
        };

      default:
        return {
          status,
          error: {
            code: "UNKNOWN_STATUS",
            message: `Unknown payment status: ${status}. Please try again or use a different card.`,
            retryable: false,
          },
        };
    }
  }
}
