import { SignUp } from "@clerk/nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  acceptsCurrentDemoTerms,
  canRenderDemoSignup,
  DEMO_TERMS_FINGERPRINT,
  DEMO_TERMS_PATH,
  DEMO_TERMS_TEXT,
  DEMO_TERMS_VERSION,
} from "@/lib/demoTerms";

const ACCEPTANCE_COOKIE = "roomscout_demo_terms";

async function acceptDemoTerms(formData: FormData) {
  "use server";
  if (!acceptsCurrentDemoTerms(formData.get("demoTerms"))) {
    redirect("/sign-up?terms=required");
  }
  (await cookies()).set(ACCEPTANCE_COOKIE, DEMO_TERMS_VERSION, {
    httpOnly: true,
    sameSite: "strict",
    // Secure cookies are mandatory on the deployed HTTPS portal. Omitting the
    // flag in local development keeps the HTTP localhost proof usable.
    secure: process.env.NODE_ENV === "production",
    path: "/sign-up",
    maxAge: 10 * 60,
  });
  redirect("/sign-up");
}

export default async function SignUpPage() {
  const accepted = canRenderDemoSignup((await cookies()).get(ACCEPTANCE_COOKIE)?.value);
  return (
    <main className="auth-page">
      {accepted ? <SignUp /> : (
        <form action={acceptDemoTerms} className="form-card demo-terms" data-roomscout-terms-kind="present" data-roomscout-terms-path={DEMO_TERMS_PATH} data-roomscout-terms-fingerprint={DEMO_TERMS_FINGERPRINT}>
          <p className="eyebrow">Controlled demo account</p>
          <h1>Demo terms</h1>
          <p>{DEMO_TERMS_TEXT}</p>
          <label className="terms-check">
            <input data-roomscout-write="demo-terms" name="demoTerms" required type="checkbox" value={DEMO_TERMS_VERSION} />
            I understand and accept these nonbinding demo-only terms.
          </label>
          <button className="button" data-roomscout-write="accept-demo-terms" type="submit">Continue to account creation</button>
        </form>
      )}
    </main>
  );
}
