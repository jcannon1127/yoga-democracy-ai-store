import {
  CybersourceOptions,
  CybersourceAuthResponse,
  CybersourceActionResponse,
} from "../types"

// The cybersource-rest-client package uses CommonJS and has no TS types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CyberSource = require("cybersource-rest-client")

type CybersourceConfig = {
  authenticationType: string
  merchantID: string
  merchantKeyId: string
  merchantsecretKey: string
  runEnvironment: string
  logConfiguration: { enableLog: boolean }
}

type AuthorizePaymentParams = {
  transientToken: string
  amount: string
  currency: string
  referenceCode: string
  capture: boolean
  fingerprintSessionId?: string
  billTo?: BillTo
}

export type BillTo = {
  firstName?: string
  lastName?: string
  address1?: string
  locality?: string
  administrativeArea?: string
  postalCode?: string
  country?: string
  email?: string
}

/** Apple Pay and Google Pay are wallet presentations of a card through the SAME
 *  merchant account -- same money flow, same capture, same refunds. They differ
 *  from the Flex card path only in how the instrument arrives: an encrypted
 *  wallet payload in `fluidData` rather than a Flex transient token.
 *
 *  paymentSolution is the wallet discriminator. Config, not a literal in logic. */
export const WALLET_PAYMENT_SOLUTION = {
  apple_pay: "001",
  google_pay: "012",
} as const

/** Apple Pay with Cybersource decryption requires a format descriptor alongside
 *  the payload. Base64 of "FID=COMMON.APPLE.INAPP.PAYMENT" -- verified by
 *  decoding it, not copied on faith. Google Pay does not use one. */
export const WALLET_FLUID_DESCRIPTOR: Record<WalletType, string | undefined> = {
  apple_pay: "RklEPUNPTU1PTi5BUFBMRS5JTkFQUC5QQVlNRU5U",
  google_pay: undefined,
}

export type WalletType = keyof typeof WALLET_PAYMENT_SOLUTION

type AuthorizeWalletParams = {
  walletType: WalletType
  /** Base64 of PKPaymentToken.paymentData (Apple) or the full wallet response
   *  string (Google). Passed to CyberSource verbatim -- we never decrypt it,
   *  which is what keeps YD out of holding an Apple payment-processing key. */
  walletPayload: string
  amount: string
  currency: string
  referenceCode: string
  capture: boolean
  fingerprintSessionId?: string
  billTo?: BillTo
}

type CapturePaymentParams = {
  csPaymentId: string
  amount: string
  currency: string
  referenceCode: string
}

type RefundPaymentParams = {
  csCaptureId: string
  amount: string
  currency: string
  referenceCode: string
}

type VoidPaymentParams = {
  csPaymentId: string
  referenceCode: string
}

type GenerateCaptureContextParams = {
  targetOrigins: string[]
  amount?: string
  currency?: string
  allowedCardNetworks: string[]
}

export class CybersourceClient {
  private config: CybersourceConfig
  private apiClient: typeof CyberSource.ApiClient

  constructor(options: CybersourceOptions) {
    this.config = {
      authenticationType: "http_signature",
      merchantID: options.merchantID,
      merchantKeyId: options.merchantKeyId,
      merchantsecretKey: options.merchantsecretKey,
      runEnvironment:
        options.environment === "production"
          ? "api.cybersource.com"
          : "apitest.cybersource.com",
      logConfiguration: { enableLog: false },
    }
    this.apiClient = new CyberSource.ApiClient()
  }

  /**
   * Generates a capture context JWT for Flex Microform initialization on the frontend.
   * Called in initiatePayment().
   */
  async generateCaptureContext(
    params: GenerateCaptureContextParams
  ): Promise<string> {
    const api = new CyberSource.MicroformIntegrationApi(
      this.config,
      this.apiClient
    )

    const request = new CyberSource.GenerateCaptureContextRequest()
    request.clientVersion = "v2"
    request.targetOrigins = params.targetOrigins
    request.allowedCardNetworks = params.allowedCardNetworks
    request.allowedPaymentTypes = ["CARD"]

    return new Promise((resolve, reject) => {
      api.generateCaptureContext(request, (error: any, data: string) => {
        if (error) {
          reject(
            new Error(
              `CyberSource generateCaptureContext failed: ${JSON.stringify(error)}`
            )
          )
          return
        }
        resolve(data)
      })
    })
  }

  /**
   * Authorizes a payment using a Flex Microform transient token.
   * Called from the pre-auth custom API route before placeOrder().
   */
  /** Shared request scaffolding for BOTH the card and wallet authorization paths.
   *  Factored out deliberately: the duplicated targetOrigins filters in this
   *  package drifted and broke every payment session (fixed 2026-08-22). Two
   *  copies of the same request builder would drift the same way. */
  private buildAuthRequest(p: {
    referenceCode: string
    capture: boolean
    amount: string
    currency: string
    billTo?: BillTo
    fingerprintSessionId?: string
  }) {
    const request = new CyberSource.CreatePaymentRequest()

    const clientRef = new CyberSource.Ptsv2paymentsClientReferenceInformation()
    clientRef.code = p.referenceCode
    request.clientReferenceInformation = clientRef

    const processingInfo = new CyberSource.Ptsv2paymentsProcessingInformation()
    processingInfo.capture = p.capture
    processingInfo.commerceIndicator = "internet"
    request.processingInformation = processingInfo

    const orderInfo = new CyberSource.Ptsv2paymentsOrderInformation()
    const amountDetails = new CyberSource.Ptsv2paymentsOrderInformationAmountDetails()
    amountDetails.totalAmount = p.amount
    amountDetails.currency = p.currency
    orderInfo.amountDetails = amountDetails

    if (p.billTo) {
      const billTo = new CyberSource.Ptsv2paymentsOrderInformationBillTo()
      if (p.billTo.firstName) billTo.firstName = p.billTo.firstName
      if (p.billTo.lastName) billTo.lastName = p.billTo.lastName
      if (p.billTo.address1) billTo.address1 = p.billTo.address1
      if (p.billTo.locality) billTo.locality = p.billTo.locality
      if (p.billTo.administrativeArea) billTo.administrativeArea = p.billTo.administrativeArea
      if (p.billTo.postalCode) billTo.postalCode = p.billTo.postalCode
      if (p.billTo.country) billTo.country = p.billTo.country
      if (p.billTo.email) billTo.email = p.billTo.email
      orderInfo.billTo = billTo
    }
    request.orderInformation = orderInfo

    if (p.fingerprintSessionId) {
      const deviceInfo = new CyberSource.Ptsv2paymentsDeviceInformation()
      deviceInfo.fingerprintSessionId = p.fingerprintSessionId
      deviceInfo.useRawFingerprintSessionId = true
      request.deviceInformation = deviceInfo
    }

    return { request, processingInfo }
  }

  /**
   * Authorize an Apple Pay or Google Pay payment.
   *
   * The wallet payload is passed to CyberSource verbatim in `fluidData` and
   * decrypted on their side. YD never holds an Apple payment-processing
   * certificate and never sees a card number -- the same PCI posture as the
   * Flex card path.
   *
   * REQUIRES digital-wallet processing enabled on the merchant. As of
   * 2026-08-23 this merchant is not provisioned for transaction processing at
   * all (POST /pts/v2/payments -> 404), so this path is UNTESTED against the
   * gateway. Do not read "it compiles" as "it works".
   */
  async authorizeWallet(
    params: AuthorizeWalletParams
  ): Promise<CybersourceAuthResponse> {
    const api = new CyberSource.PaymentsApi(this.config, this.apiClient)
    const { request, processingInfo } = this.buildAuthRequest(params)

    // The wallet discriminator: 001 Apple Pay, 012 Google Pay.
    processingInfo.paymentSolution = WALLET_PAYMENT_SOLUTION[params.walletType]

    const paymentInfo = new CyberSource.Ptsv2paymentsPaymentInformation()
    const fluidData = new CyberSource.Ptsv2paymentsPaymentInformationFluidData()
    fluidData.value = params.walletPayload
    const descriptor = WALLET_FLUID_DESCRIPTOR[params.walletType]
    if (descriptor) fluidData.descriptor = descriptor
    paymentInfo.fluidData = fluidData
    request.paymentInformation = paymentInfo

    return new Promise((resolve, reject) => {
      api.createPayment(request, (error: any, data: any) => {
        if (error) {
          reject(
            new Error(
              `CyberSource authorizeWallet (${params.walletType}) failed: ${JSON.stringify(error)}`
            )
          )
          return
        }
        resolve(data as CybersourceAuthResponse)
      })
    })
  }

  async authorizePayment(
    params: AuthorizePaymentParams
  ): Promise<CybersourceAuthResponse> {
    const api = new CyberSource.PaymentsApi(this.config, this.apiClient)

    const request = new CyberSource.CreatePaymentRequest()

    // Client reference (idempotency key)
    const clientRef =
      new CyberSource.Ptsv2paymentsClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    // Processing information
    const processingInfo =
      new CyberSource.Ptsv2paymentsProcessingInformation()
    processingInfo.capture = params.capture
    processingInfo.commerceIndicator = "internet"
    request.processingInformation = processingInfo

    // Flex Microform v2: pass the transient token JWT via tokenInformation
    const tokenInfo = new CyberSource.Ptsv2paymentsTokenInformation()
    tokenInfo.transientTokenJwt = params.transientToken
    request.tokenInformation = tokenInfo

    // Order information
    const orderInfo = new CyberSource.Ptsv2paymentsOrderInformation()
    const amountDetails =
      new CyberSource.Ptsv2paymentsOrderInformationAmountDetails()
    amountDetails.totalAmount = params.amount
    amountDetails.currency = params.currency
    orderInfo.amountDetails = amountDetails

    if (params.billTo) {
      const billTo = new CyberSource.Ptsv2paymentsOrderInformationBillTo()
      if (params.billTo.firstName) billTo.firstName = params.billTo.firstName
      if (params.billTo.lastName) billTo.lastName = params.billTo.lastName
      if (params.billTo.address1) billTo.address1 = params.billTo.address1
      if (params.billTo.locality) billTo.locality = params.billTo.locality
      if (params.billTo.administrativeArea)
        billTo.administrativeArea = params.billTo.administrativeArea
      if (params.billTo.postalCode) billTo.postalCode = params.billTo.postalCode
      if (params.billTo.country) billTo.country = params.billTo.country
      if (params.billTo.email) billTo.email = params.billTo.email
      orderInfo.billTo = billTo
    }

    request.orderInformation = orderInfo

    // Device Fingerprint — required for production fraud scoring.
    // useRawFingerprintSessionId=true tells CyberSource to look up ThreatMetrix
    // using the raw session ID (our UUID), not merchantId+sessionId (the default).
    // The script URL on the frontend uses session_id=<uuid>, so both sides must match.
    if (params.fingerprintSessionId) {
      const deviceInfo = new CyberSource.Ptsv2paymentsDeviceInformation()
      deviceInfo.fingerprintSessionId = params.fingerprintSessionId
      deviceInfo.useRawFingerprintSessionId = true
      request.deviceInformation = deviceInfo
    }

    return new Promise((resolve, reject) => {
      api.createPayment(
        request,
        (error: any, data: CybersourceAuthResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource authorizePayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Captures a previously authorized payment.
   * Called in capturePayment().
   */
  async capturePayment(
    params: CapturePaymentParams
  ): Promise<CybersourceActionResponse> {
    const api = new CyberSource.CaptureApi(this.config, this.apiClient)

    const request = new CyberSource.CapturePaymentRequest()

    const clientRef =
      new CyberSource.Ptsv2paymentsidClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    const orderInfo =
      new CyberSource.Ptsv2paymentsidcapturesOrderInformation()
    const amountDetails =
      new CyberSource.Ptsv2paymentsidcapturesOrderInformationAmountDetails()
    amountDetails.totalAmount = params.amount
    amountDetails.currency = params.currency
    orderInfo.amountDetails = amountDetails
    request.orderInformation = orderInfo

    return new Promise((resolve, reject) => {
      api.capturePayment(
        request,
        params.csPaymentId,
        (error: any, data: CybersourceActionResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource capturePayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Voids an authorized payment (before capture / same-day only).
   * Called in cancelPayment().
   */
  async voidPayment(
    params: VoidPaymentParams
  ): Promise<CybersourceActionResponse> {
    const api = new CyberSource.VoidApi(this.config, this.apiClient)

    const request = new CyberSource.VoidPaymentRequest()

    const clientRef =
      new CyberSource.Ptsv2paymentsidClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    return new Promise((resolve, reject) => {
      api.voidPayment(
        request,
        params.csPaymentId,
        (error: any, data: CybersourceActionResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource voidPayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Refunds a captured payment (partial or full).
   * Called in refundPayment().
   */
  async refundPayment(
    params: RefundPaymentParams
  ): Promise<CybersourceActionResponse> {
    const api = new CyberSource.RefundApi(this.config, this.apiClient)

    const request = new CyberSource.RefundPaymentRequest()

    const clientRef =
      new CyberSource.Ptsv2paymentsidrefundsClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    // The refund OrderInformation reuses the captures AmountDetails class
    const orderInfo =
      new CyberSource.Ptsv2paymentsidrefundsOrderInformation()
    const amountDetails =
      new CyberSource.Ptsv2paymentsidcapturesOrderInformationAmountDetails()
    amountDetails.totalAmount = params.amount
    amountDetails.currency = params.currency
    orderInfo.amountDetails = amountDetails
    request.orderInformation = orderInfo

    return new Promise((resolve, reject) => {
      api.refundPayment(
        request,
        params.csCaptureId,
        (error: any, data: CybersourceActionResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource refundPayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Retrieves transaction details from CyberSource.
   * Called in retrievePayment() and getPaymentStatus().
   */
  async getTransaction(transactionId: string): Promise<any> {
    const api = new CyberSource.TransactionDetailsApi(
      this.config,
      this.apiClient
    )

    return new Promise((resolve, reject) => {
      api.getTransaction(transactionId, (error: any, data: any) => {
        if (error) {
          reject(
            new Error(
              `CyberSource getTransaction failed: ${JSON.stringify(error)}`
            )
          )
          return
        }
        resolve(data)
      })
    })
  }
}
