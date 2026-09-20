# roomscout.dev controlled portal

A separate Next.js + Clerk + Convex application used as an honest Browserbase,
AgentMail, Firecrawl, and native-messaging test target for RoomScout. It is not
fixture UI inside the RoomScout product.

## Live deployment

- Portal: https://roomscout.dev
- Hosting: Vercel project `roomscout-dev`
- Backend: separate Convex production deployment `sensible-ladybug-38`
- Auth: separate Clerk application with email/password and verification-code
  support

The public listing and Clerk entry routes are live. The controlled registration,
native-message and provider-reply loop was verified for the BER01 pilot below;
deployment alone is not evidence that every scenario has been exercised.

The fictional Berlin provider engine is deployed, with acceptance still in
progress. Its catalog seed inserted 24 controlled listings into
`sensible-ladybug-38`; an immediate second run reported 24 unchanged records
and preserved the older Stuttgart listing. RoomScout then processed all 24
public detail pages through its normal Firecrawl path as distinct AI-simulated
signals. A fresh account completed normal portal registration, sent the BER01
initial inquiry, received a real AI reply through the portal notification path,
and produced a main-app assessment. All 24 Berlin scenario mappings are enabled.
Microphone and full human binding acceptance are
not yet proven.

Room images are generated with OpenAI Imagegen and stored under
`public/demo-rooms/`; the public-only prompt set is in
`providerScenarios/room-image-prompts.json`. All 25 published room images have
been imported by RoomScout through Firecrawl. Listing copy uses normal room
facts and real street names without house numbers; one portal-wide banner
explains the simulation instead of repeating it inside every listing.

## What it proves

- Supply and demand listings are server-rendered and publicly crawlable.
- Posting, inbox reads, and messages require a real Clerk session.
- Clerk can be configured for email + password with email verification codes.
- A RoomScout agent can register with its AgentMail inbox, receive the Clerk
  code there, and continue the same persisted Browserbase session.
- Native messages use direct authenticated Convex client mutations. Inbox and
  thread HTML is server-rendered first for deterministic Browserbase reads,
  then kept reactive by Convex. Only the listing owner or initiating account
  can read a thread.
- Each AI-simulated provider conversation owns a separate thread in the Convex
  Agent Component. The shared engine loads the listing's versioned fictional
  profile and persists conversation state per portal thread; it does not run 24
  separate agent deployments.
- Every new portal message can enqueue one transactional "new message" email
  through the official `@agentmail/convex` component. The component supplies
  its own Workpool-backed durable queue and retries. The portal's transactional
  per-message guard prevents duplicate enqueueing. The notification deliberately
  omits the private message body and links to the authenticated portal thread.

## Setup

1. `npm install`
2. Create a separate Clerk application. Enable email + password, require email,
   and enable verification codes at sign-up.
3. Activate Clerk's Convex integration and copy its issuer domain.
4. Copy `.env.example` to `.env.local` and set the Clerk values.
5. Run `npx convex dev`; choose a new project for this portal. Set
   `CLERK_JWT_ISSUER_DOMAIN` on that Convex deployment as well.
6. Run `npm run dev` and open `http://localhost:3000`.

### Message notification email

Set `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, and
`AGENTMAIL_NOTIFICATION_INBOX_ID=roomscout-notifications@agentmail.to` on each
portal Convex deployment. Register `https://<portal-deployment>.convex.site/agentmail/webhook`
for the dedicated sender inbox. The component reads `AGENTMAIL_API_KEY` directly;
it is not a constructor option. The sender uses AgentMail's domain, not a custom domain.

The Clerk Convex token must contain the signed `email` claim (and, when
available, `email_verified`). RoomScout stores that address privately by Clerk
subject; public listing and thread projections never expose it.

### Participant reset

`POST https://<portal-deployment>.convex.site/participant-reset` with the header
`X-RoomScout-Reset-Secret: <PORTAL_RESET_SECRET>` and the body
`{ "emailAddresses": ["band@agentmail.to"] }` (one to five addresses) wipes the
matched portal accounts' conversations: their threads, messages, simulated
provider jobs, runtime state and the attached Agent-component threads. The
portal account, its Clerk login, listings and scenario bindings stay, so the
next message starts every simulated provider at its scenario's default state.
The response is `202 { resetIds, matched }` when an account matched, `200` with
`matched: 0` otherwise, `401` for a wrong secret, `400` for a malformed body and
`503` while `PORTAL_RESET_SECRET` is not set on the portal deployment. Deletion
runs asynchronously in bounded pages after the response; `participantResets`
holds the progress. The RoomScout app calls this from its own reset button.

## Wire it to RoomScout

After deploying this portal to its own domain and configuring Clerk:

1. In RoomScout Ops, run the controlled demo-portal seed with the canonical
   portal base URL. This creates the platform, one paused public source, one
   authenticated source, the first-party contact policy, and the
   `roomscout-dev-v1` adapter binding. It does not crawl or message anyone.
2. Review the public source and only then activate its monitor target. Keep the
   first pilot to one bounded listing change.
3. From a musician account, request a connection to the controlled portal. An
   operator must approve that exact source before automated onboarding is
   available.
4. Provision the musician's personal AgentMail inbox, then choose **Let Scout
   register**. RoomScout opens `/sign-up` in a persisted Browserbase Context and
   uses that inbox as the Clerk email address.
5. Clerk sends its verification code to AgentMail. RoomScout accepts only one
   unambiguous, portal-relevant code and enters it into the same browser session.
   The controlled first signup may use an ephemeral generated password that is
   never stored. Existing-credential prompts, password changes, CAPTCHA, terms,
   payment, and ambiguous-code states require human takeover.
6. A reviewed platform-message action can then open `/listings/<id>`, populate
   the stable `data-roomscout-*` fields, and submit only the exact approved
   content. A unique `data-roomscout-write-result="sent"` receipt appears only
   after Convex returns the persisted thread and message IDs; an existing
   thread never exposes that write-success marker before a new submit. Later
   read-only syncs import reactive portal replies from `/inbox`.

The stable attributes are part of this controlled integration contract; update
the RoomScout adapter and its tests whenever they change. Never point the
first-party adapter at a third-party portal.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. The
tests prove that public listing projections do not expose Clerk subjects and
that only thread members can read native messages. They do not replace one
deployed Clerk email-verification and Browserbase session proof.

The current `roomscout.dev` deployment still uses a Clerk development instance.
That is adequate for this bounded controlled proof but must be replaced by
production Clerk keys before treating the portal as production-ready.

The main RoomScout landing page reuses its existing orange Mapbox renderer for
the versioned public-research snapshot. Its browser configuration uses an
existing public token from the Jumper map configuration; no token value belongs
in this README. Fictional Berlin listings remain separate from real research
coverage.

Before a live demo, create only controlled accounts and listings. RoomScout must
still apply its own exact Approve / non-binding YOLO policy before Browserbase
submits a portal message. Existing credentials, password changes, CAPTCHA, 2FA,
and binding commitments stay human-controlled.
