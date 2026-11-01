export type BillingEvent =
  | {
      type: "subscription.active";
      polarCustomerId: string;
      polarSubscriptionId: string;
      periodEnd: number;
      periodKey: string;
      productId: string;
    }
  | {
      type: "subscription.renewed";
      polarSubscriptionId: string;
      periodEnd: number;
      periodKey: string;
    }
  | {
      type: "subscription.canceled";
      polarSubscriptionId: string;
    }
  | {
      type: "subscription.past_due";
      polarSubscriptionId: string;
    };

export interface BillingProvider {
  verifyAndParse(req: Request, secret: string): Promise<BillingEvent | null>;
}
