export const DEMO_TERMS_VERSION = "roomscout-demo-terms-v1" as const;
export const DEMO_TERMS_PATH = "/demo-terms/v1" as const;
export const DEMO_TERMS_TEXT =
  "RoomScout controlled-demo terms v1: This free test account is for the nonbinding roomscout.dev demo only. No payment, booking, contract, or real-world service is created." as const;
export const DEMO_TERMS_FINGERPRINT =
  "v1:a79f5f309eaf31c27fcf8bc22876360710a6f7fa734d21d02115b6b42513268c" as const;

export function acceptsCurrentDemoTerms(value: FormDataEntryValue | null): boolean {
  return value === DEMO_TERMS_VERSION;
}

export function canRenderDemoSignup(cookieValue: string | undefined): boolean {
  return cookieValue === DEMO_TERMS_VERSION;
}
