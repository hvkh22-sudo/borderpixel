/**
 * RevenueCat wrapper. The app never decides entitlement on its own: access is
 * derived from CustomerInfo (cached by the SDK for offline use).
 */
import Purchases, { CustomerInfo, LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';

import { CustomerInfoLike } from '../features/monetization/entitlements';
import { config } from './config';

let configured = false;

export function purchasesAvailable(): boolean {
  return config.revenueCatApiKey.length > 0;
}

export function configurePurchases(): boolean {
  if (configured) return true;
  if (!purchasesAvailable()) return false;
  if (__DEV__) void Purchases.setLogLevel(LOG_LEVEL.WARN);
  // Anonymous RevenueCat user id: no account required.
  Purchases.configure({ apiKey: config.revenueCatApiKey });
  configured = true;
  return true;
}

export function toCustomerInfoLike(info: CustomerInfo): CustomerInfoLike {
  const active: CustomerInfoLike['entitlements']['active'] = {};
  for (const [key, e] of Object.entries(info.entitlements.active)) {
    active[key] = {
      isActive: e.isActive,
      productIdentifier: e.productIdentifier,
      expirationDate: e.expirationDate,
      willRenew: e.willRenew,
      billingIssueDetectedAt: e.billingIssueDetectedAt,
    };
  }
  return {
    entitlements: { active },
    nonSubscriptionProductIds: info.nonSubscriptionTransactions.map((t) => t.productIdentifier),
  };
}

export async function fetchCustomerInfo(): Promise<CustomerInfoLike | null> {
  if (!configurePurchases()) return null;
  return toCustomerInfoLike(await Purchases.getCustomerInfo());
}

export function subscribeCustomerInfo(cb: (info: CustomerInfoLike) => void): () => void {
  if (!configurePurchases()) return () => {};
  const listener = (info: CustomerInfo) => cb(toCustomerInfoLike(info));
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export interface PaywallPackages {
  monthly: PurchasesPackage | null;
  annual: PurchasesPackage | null;
  lifetime: PurchasesPackage | null;
}

export async function fetchPackages(): Promise<PaywallPackages> {
  if (!configurePurchases()) return { monthly: null, annual: null, lifetime: null };
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  return {
    monthly: current?.monthly ?? null,
    annual: current?.annual ?? null,
    lifetime: current?.lifetime ?? null,
  };
}

export type PurchaseOutcome =
  | { status: 'purchased'; info: CustomerInfoLike }
  | { status: 'cancelled' }
  | { status: 'pending' }
  | { status: 'error'; message: string };

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', info: toCustomerInfoLike(customerInfo) };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; code?: string; message?: string };
    if (err.userCancelled || err.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { status: 'cancelled' };
    }
    if (err.code === Purchases.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { status: 'pending' };
    return { status: 'error', message: err.message ?? 'Purchase failed' };
  }
}

export async function restore(): Promise<CustomerInfoLike | null> {
  if (!configurePurchases()) return null;
  return toCustomerInfoLike(await Purchases.restorePurchases());
}

export async function openManageSubscriptions(): Promise<void> {
  if (!configurePurchases()) return;
  await Purchases.showManageSubscriptions();
}

/** Anonymous RevenueCat app user id, used to authenticate AI requests. */
export async function appUserId(): Promise<string | null> {
  if (!configurePurchases()) return null;
  return Purchases.getAppUserID();
}
