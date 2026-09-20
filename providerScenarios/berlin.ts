import type { ProviderScenarioFact, ScenarioDefinition } from "../convex/providerScenarios/types";

export const BERLIN_CATALOG_SCHEMA_VERSION = 1 as const;
export const BERLIN_CATALOG_VERSION = 1 as const;
export const BERLIN_CATALOG_SEED_PREFIX = "berlin-demo-v1" as const;

export type ProviderTone = "warm" | "precise" | "practical" | "careful" | "busy";
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

type CatalogScenarioInput = {
  scenarioId: `BER-${string}`;
  publicListing: {
    slug: string;
    ownerLabel: string;
    title: string;
    city: "Berlin";
    district: string;
    latitude: number;
    longitude: number;
    locationPrecision: "approximate_fictional";
    description: string;
    monthlyPriceEur: number;
    priceBasis: "one_fixed_weekly_slot_per_month";
    areaSquareMeters: number;
    capacity: number;
    weeklySlots: Array<{ weekday: Weekday; start: string; end: string }>;
    equipment: string[];
    access: string[];
    publicFacts: string[];
    disclosure: "Fictional room · AI-simulated provider · Interactive demo";
  };
  providerProfile: {
    fictionalName: string;
    shortBackstory: string;
    tone: ProviderTone;
    styleNotes: string[];
  };
  privateFacts: Array<{
    factId: string;
    statement: string;
    disclosure: "initial" | "when_relevant" | "when_asked" | "after_first_reply";
  }>;
  allowedTransitions: Array<{
    transitionId: string;
    trigger: "first_message" | "relevant_question" | "follow_up";
    revealFactIds: string[];
    nextState: string;
    terminal?: boolean;
  }>;
  demoTags: string[];
};

export type BerlinProviderScenarioDefinition = ScenarioDefinition & {
  seedKey: `${typeof BERLIN_CATALOG_SEED_PREFIX}:${string}`;
  catalog: {
    slug: string;
    ownerLabel: string;
    street: string;
    latitude: number;
    longitude: number;
    locationPrecision: "approximate_fictional";
    areaSquareMeters: number;
    capacity: number;
    weeklySlots: CatalogScenarioInput["publicListing"]["weeklySlots"];
    equipment: string[];
    access: string[];
    disclosure: CatalogScenarioInput["publicListing"]["disclosure"];
    demoTags: string[];
  };
};

/** Rooms whose slot is available immediately: Hofsignal, Ostschleife, Modul Ost. */
const DEMO_EARLY_START_IDS = new Set([4, 16, 23]);

function contractFacts(id: number): ProviderScenarioFact[] {
  const startDates = [
    { en: "The slot can start on the first of October 2026.", de: "Der Slot kann zum ersten Oktober 2026 starten." },
    { en: "The slot can start in mid-October 2026.", de: "Der Slot kann Mitte Oktober 2026 starten." },
    { en: "The slot can start on the first of November 2026.", de: "Der Slot kann zum ersten November 2026 starten." },
  ] as const;
  const noticePeriods = [
    { en: "Cancellation requires one full calendar month's notice to month-end.", de: "Die Kündigungsfrist beträgt einen vollen Kalendermonat zum Monatsende." },
    { en: "Cancellation requires six weeks' notice to month-end.", de: "Die Kündigungsfrist beträgt sechs Wochen zum Monatsende." },
    { en: "Cancellation requires two full calendar months' notice to month-end.", de: "Die Kündigungsfrist beträgt zwei volle Kalendermonate zum Monatsende." },
  ] as const;
  const minimumCommitment = id === 8
    ? { en: "The minimum commitment is twelve months.", de: "Die Mindestlaufzeit beträgt zwölf Monate." }
    : id === 2
      ? { en: "The minimum commitment is three months.", de: "Die Mindestlaufzeit beträgt drei Monate." }
      : id % 4 === 0
        ? { en: "The minimum commitment is six months.", de: "Die Mindestlaufzeit beträgt sechs Monate." }
        : { en: "The minimum commitment is three months.", de: "Die Mindestlaufzeit beträgt drei Monate." };
  if (id === 18) {
    return [
      { id: "contract_start", visibility: "private", disclosure: "on_request", kind: "term", term: "other", value: { en: "There is no start date because the advertised slot has been withdrawn.", de: "Es gibt keinen Starttermin, weil der ausgeschriebene Slot vergeben ist." } },
      { id: "contract_minimum", visibility: "private", disclosure: "on_request", kind: "term", term: "minimum_commitment", value: minimumCommitment },
      { id: "contract_notice", visibility: "private", disclosure: "on_request", kind: "term", term: "notice_period", value: noticePeriods[(id - 1) % noticePeriods.length]! },
      { id: "viewing_path", visibility: "private", disclosure: "when_relevant", kind: "term", term: "other", value: { en: "No viewing can be arranged while the slot is unavailable; do not invite the band to a viewing.", de: "Solange der Slot nicht verfügbar ist, kann keine Besichtigung vereinbart werden; lade die Band nicht dazu ein." } },
    ];
  }
  // Demo happy-path rooms are free right away and say so unprompted; the rest
  // of the catalog keeps its October/November starts so urgency still bites.
  const earlyStart = DEMO_EARLY_START_IDS.has(id);
  return [
    earlyStart
      ? { id: "contract_start", visibility: "private", disclosure: "when_relevant", kind: "term", term: "other", value: {
        en: "The slot is free right away; the contract can start on Friday, 25 September 2026, or any later date the band prefers.",
        de: "Der Slot ist sofort frei; der Vertrag kann am Freitag, 25. September 2026, oder zu jedem späteren Wunschtermin starten.",
      } }
      : { id: "contract_start", visibility: "private", disclosure: "on_request", kind: "term", term: "other", value: startDates[(id - 1) % startDates.length]! },
    { id: "contract_minimum", visibility: "private", disclosure: "on_request", kind: "term", term: "minimum_commitment", value: minimumCommitment },
    { id: "contract_notice", visibility: "private", disclosure: "on_request", kind: "term", term: "notice_period", value: noticePeriods[(id - 1) % noticePeriods.length]! },
    { id: "viewing_path", visibility: "private", disclosure: "when_relevant", kind: "term", term: "other", value: {
      en: "A viewing can be arranged before the start date. Minor contract details that are not listed can be confirmed at the viewing and do not prevent arranging it.",
      de: "Eine Besichtigung kann vor dem Starttermin vereinbart werden. Kleinere nicht aufgeführte Vertragsdetails können dort geklärt werden und verhindern die Terminvereinbarung nicht.",
    } },
  ];
}

function scenario(
  id: number,
  input: Omit<CatalogScenarioInput, "scenarioId">,
): BerlinProviderScenarioDefinition {
  const scenarioId = `BER-${String(id).padStart(2, "0")}` as const;
  const street = BERLIN_STREETS[input.publicListing.slug];
  if (!street) throw new Error("BERLIN_CATALOG_STREET_MISSING");
  const factNotes = new Map(input.privateFacts.map((item) => [item.factId, item]));
  const recurringPriceFacts: ProviderScenarioFact[] = id === 5
    ? [
        { id: "price_base", visibility: "public", disclosure: "public", kind: "price", amountEur: 210, cadence: "month", component: "base", recurringCostsKnown: true },
        { id: "price_service_charge", visibility: "private", disclosure: "when_relevant", kind: "price", amountEur: 55, cadence: "month", component: "mandatory_extra", recurringCostsKnown: true },
        { id: "price_total", visibility: "private", disclosure: "when_relevant", kind: "price", amountEur: 265, cadence: "month", component: "total", recurringCostsKnown: true },
      ]
    : [{
        id: "price_monthly",
        visibility: "public",
        disclosure: "public",
        kind: "price",
        amountEur: input.publicListing.monthlyPriceEur,
        cadence: "month",
        component: id === 14 ? "base" : "total",
        recurringCostsKnown: id !== 14,
      }];
  const slotFacts: ProviderScenarioFact[] = input.publicListing.weeklySlots.map((weeklySlot, index) => ({
    id: `slot_${index + 1}`,
    visibility: "public",
    disclosure: "public",
    kind: "slot",
    weekday: weeklySlot.weekday,
    startTime: weeklySlot.start,
    endTime: weeklySlot.end,
    status: id === 18 ? "unavailable" : "available",
  }));
  if (id === 20) slotFacts.push({ id: "slot_tuesday_unavailable", visibility: "public", disclosure: "public", kind: "slot", weekday: "tuesday", startTime: "18:00", endTime: "22:00", status: "unavailable" });
  if (id === 22) slotFacts.push({ id: "slot_superseded", visibility: "private", disclosure: "when_relevant", kind: "slot", weekday: "wednesday", startTime: "18:00", endTime: "22:00", status: "unavailable" });
  const searchableText = [...input.publicListing.equipment, ...input.publicListing.access, ...input.publicListing.publicFacts].join(" ").toLowerCase();
  const featureFacts: ProviderScenarioFact[] = [];
  const addFeature = (feature: Extract<ProviderScenarioFact, { kind: "feature" }>["feature"], status: Extract<ProviderScenarioFact, { kind: "feature" }>["status"]) => {
    featureFacts.push({ id: `feature_${feature}`, visibility: "public", disclosure: "public", kind: "feature", feature, status });
  };
  if (/drum kit|electronic drum/.test(searchableText)) addFeature("drum_kit", "provided");
  if (/\bpa\b/.test(searchableText)) addFeature("pa", "provided");
  if (/cabinet|\bamps?\b/.test(searchableText)) addFeature("backline", "provided");
  if (/no acoustic drums|acoustic drums are prohibited/.test(searchableText)) addFeature("acoustic_drums", "not_allowed");
  else if (/drum permission not yet confirmed|require.*confirmation/.test(searchableText)) addFeature("acoustic_drums", "conditional");
  else if (/drums allowed|loud drums|acoustic drums allowed/.test(searchableText)) addFeature("acoustic_drums", "allowed");
  if (/storage confirmation pending/.test(searchableText)) addFeature("storage", "unknown");
  else if (/no overnight.*storage/.test(searchableText)) addFeature("storage", "not_allowed");
  else if (/storage|lockable shelf/.test(searchableText)) addFeature("storage", "provided");
  if (/own key|keycard|door code/.test(searchableText)) addFeature("key", "provided");
  if (/ground.floor|\blift\b/.test(searchableText)) addFeature("step_free", "allowed");
  const facts: ProviderScenarioFact[] = [
    ...recurringPriceFacts,
    ...slotFacts,
    ...featureFacts,
    ...contractFacts(id),
    { id: "listing_capacity", visibility: "public", disclosure: "public", kind: "capacity", maximumPeople: input.publicListing.capacity },
    ...input.publicListing.publicFacts.map((statement, index) => ({
      id: `public_${index + 1}`,
      visibility: "public" as const,
      disclosure: "public" as const,
      kind: "term" as const,
      term: "other" as const,
      value: { en: statement, de: statement },
    })),
    ...input.privateFacts.map((item) => ({
      id: item.factId,
      visibility: "private" as const,
      disclosure: item.disclosure === "when_asked" ? "on_request" as const : "when_relevant" as const,
      kind: "term" as const,
      term: "other" as const,
      value: { en: item.statement, de: item.statement },
    })),
  ];
  let previousState = "default";
  const transitions = input.allowedTransitions.map((item) => {
    const triggerText = item.revealFactIds.map((factId) => factNotes.get(factId)?.statement ?? factId).join(" ");
    const mapped = { id: item.transitionId, fromState: previousState, toState: item.nextState, trigger: { en: triggerText, de: triggerText } };
    previousState = item.nextState;
    return mapped;
  });
  return {
    schemaVersion: 1,
    scenarioId,
    version: BERLIN_CATALOG_VERSION,
    seedKey: `${BERLIN_CATALOG_SEED_PREFIX}:${scenarioId}`,
    publicListing: {
      title: input.publicListing.title,
      city: input.publicListing.city,
      district: input.publicListing.district,
      street,
      description: input.publicListing.description,
      imageUrl: `https://roomscout.dev/demo-rooms/${input.publicListing.slug}.webp`,
      priceEur: input.publicListing.monthlyPriceEur,
      pricePeriod: "month",
      publicFactIds: facts.filter((item) => item.visibility === "public").map((item) => item.id),
    },
    providerProfile: {
      fictionalName: input.providerProfile.fictionalName,
      shortBackstory: { en: input.providerProfile.shortBackstory, de: input.providerProfile.shortBackstory },
      tone: { en: [input.providerProfile.tone, ...input.providerProfile.styleNotes].join(". "), de: [input.providerProfile.tone, ...input.providerProfile.styleNotes].join(". ") },
    },
    facts,
    ...(transitions.length ? { dynamic: { initialState: "default", transitions } } : {}),
    catalog: {
      slug: input.publicListing.slug,
      ownerLabel: input.publicListing.ownerLabel,
      street,
      latitude: input.publicListing.latitude,
      longitude: input.publicListing.longitude,
      locationPrecision: input.publicListing.locationPrecision,
      areaSquareMeters: input.publicListing.areaSquareMeters,
      capacity: input.publicListing.capacity,
      weeklySlots: input.publicListing.weeklySlots,
      equipment: input.publicListing.equipment,
      access: input.publicListing.access,
      disclosure: input.publicListing.disclosure,
      demoTags: input.demoTags,
    },
  };
}

const BERLIN_STREETS: Record<string, string> = {
  "kanalwerk-a": "Reichenberger Straße", "brueckenbeat": "Kopernikusstraße", "ringraum-sued": "Tempelhofer Damm",
  "hofsignal": "Adalbertstraße", "nebenkanal": "Weichselstraße", "treppenhaus-sessions": "Kreuzbergstraße",
  "suedstern-frequenz": "Südstern", "gleisbogen": "Belziger Straße", "morgenmodul": "Revaler Straße",
  "rollfeld-drei": "Boddinstraße", "leisetreter": "Hertzbergstraße", "westakkord": "Belziger Straße",
  "werkhalle-takt": "Stromstraße", "nordstrom-probe": "Schulstraße", "gartenpegel": "Breite Straße",
  "ostschleife": "Roedeliusplatz", "transitspur": "Elsenstraße", "waldpuls": "Köpenicker Landstraße",
  "westfenster": "Schillerstraße", "schichtwechsel": "Natalissteig", "nordresonanz": "Oranienburger Straße",
  "seetakt": "Berliner Allee", "modul-ost": "Alt-Marzahn", "uferklang": "Grünstraße",
};

const disclosure = "Fictional room · AI-simulated provider · Interactive demo" as const;
const basis = "one_fixed_weekly_slot_per_month" as const;
const place = (district: string, latitude: number, longitude: number) => ({
  city: "Berlin" as const, district, latitude, longitude,
  locationPrecision: "approximate_fictional" as const,
});
const slot = (weekday: Weekday, start = "18:00", end = "22:00") => ({ weekday, start, end });
const profile = (fictionalName: string, shortBackstory: string, tone: ProviderTone, ...styleNotes: string[]) => ({
  fictionalName, shortBackstory, tone, styleNotes,
});
const fact = (factId: string, statement: string, disclosureRule: CatalogScenarioInput["privateFacts"][number]["disclosure"] = "when_relevant") => ({ factId, statement, disclosure: disclosureRule });
const transition = (transitionId: string, trigger: CatalogScenarioInput["allowedTransitions"][number]["trigger"], revealFactIds: string[], nextState: string, terminal = false) => ({ transitionId, trigger, revealFactIds, nextState, ...(terminal ? { terminal: true } : {}) });

export const BERLIN_PROVIDER_SCENARIOS: readonly BerlinProviderScenarioDefinition[] = [
  scenario(1, { publicListing: { slug: "kanalwerk-a", ownerLabel: "Mara at Kanalwerk", title: "Kanalwerk A", ...place("Kreuzberg", 52.498, 13.421), description: "Warm 32 m² band room with a fixed Wednesday evening slot, house drum kit and lockable storage.", monthlyPriceEur: 350, priceBasis: basis, areaSquareMeters: 32, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["house drum kit", "PA", "guitar cabinets"], access: ["lockable storage", "shared ground-floor entrance"], publicFacts: ["Loud acoustic drums allowed", "All recurring charges included"], disclosure }, providerProfile: profile("Mara Levin", "A drummer who coordinates two rooms in a small self-managed band house.", "warm", "Answer directly", "Use light dry humour only when natural"), privateFacts: [fact("all_in", "EUR 350 is the complete recurring monthly total.", "initial"), fact("storage", "One drum kit may remain in the lockable cage."), fact("available", "Wednesday 18:00–22:00 is available for up to five people.", "initial")], allowedTransitions: [transition("confirm-fit", "first_message", ["all_in", "available"], "questions_open"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["main_fit", "drums", "storage"] }),
  scenario(2, { publicListing: { slug: "brueckenbeat", ownerLabel: "Jonas at Brückenbeat", title: "Brückenbeat", ...place("Friedrichshain", 52.510, 13.454), description: "38 m² treated rehearsal room with a Thursday evening slot and a maintained drum kit.", monthlyPriceEur: 380, priceBasis: basis, areaSquareMeters: 38, capacity: 6, weeklySlots: [slot("thursday")], equipment: ["drum kit", "PA", "bass cabinet"], access: ["keycard", "lockable shelf"], publicFacts: ["All recurring charges included", "Three-month minimum term"], disclosure }, providerProfile: profile("Jonas Kern", "A live-sound technician who keeps the room organised between touring jobs.", "precise", "Keep answers short", "Use exact times and costs"), privateFacts: [fact("all_in", "EUR 380 is all-inclusive.", "initial"), fact("minimum_term", "The minimum rental term is three months."), fact("storage", "A lockable shelf and space beside the house kit are included.")], allowedTransitions: [transition("state-terms", "first_message", ["all_in", "minimum_term"], "terms_shared"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["main_fit", "minimum_term", "drums"] }),
  scenario(3, { publicListing: { slug: "ringraum-sued", ownerLabel: "Aylin at Ringraum Süd", title: "Ringraum Süd", ...place("Tempelhof", 52.470, 13.385), description: "Practical 35 m² room for a weekly Tuesday rehearsal, with code access and space for a resident kit.", monthlyPriceEur: 395, priceBasis: basis, areaSquareMeters: 35, capacity: 5, weeklySlots: [slot("tuesday")], equipment: ["PA", "two guitar cabinets"], access: ["door code", "ground-floor loading"], publicFacts: ["Own drum kit may remain", "All recurring charges included"], disclosure }, providerProfile: profile("Aylin Demir", "A former touring keyboard player who now shares two practical rehearsal rooms.", "practical", "Prioritise logistics", "Do not oversell"), privateFacts: [fact("all_in", "EUR 395 is the complete monthly total.", "initial"), fact("storage", "One labelled drum kit can remain assembled."), fact("access", "Each band receives its own door code after agreement.")], allowedTransitions: [transition("confirm-slot", "first_message", ["all_in"], "questions_open"), transition("confirm-logistics", "relevant_question", ["storage", "access"], "offer_ready")], demoTags: ["main_fit", "drums", "storage"] }),
  scenario(4, { publicListing: { slug: "hofsignal", ownerLabel: "Timo at Hofsignal", title: "Hofsignal", ...place("Kreuzberg", 52.500, 13.418), description: "Compact 26 m² room for four musicians, Wednesday evenings, with secure shared storage.", monthlyPriceEur: 320, priceBasis: basis, areaSquareMeters: 26, capacity: 4, weeklySlots: [slot("wednesday")], equipment: ["PA", "drum rug"], access: ["courtyard access", "secure shared storage"], publicFacts: ["Loud drums allowed", "All recurring charges included"], disclosure }, providerProfile: profile("Timo Brandt", "A bassist who organises the room for three local bands.", "warm", "Acknowledge budget questions plainly", "Never quote an older lower price"), privateFacts: [fact("current_price", "The current and complete monthly price is EUR 320.", "initial"), fact("budget_path", "The price is fixed; do not bargain or mention the musician's private budget."), fact("storage", "A drum kit fits in the secure shared storage zone.")], allowedTransitions: [transition("confirm-current-price", "first_message", ["current_price"], "questions_open"), transition("confirm-fit", "relevant_question", ["storage"], "offer_ready")], demoTags: ["budget_250_to_400", "drums", "storage"] }),
  scenario(5, { publicListing: { slug: "nebenkanal", ownerLabel: "Nebenkanal Verwaltung", title: "Nebenkanal", ...place("Neukölln", 52.486, 13.435), description: "30 m² shared rehearsal room with a fixed Thursday evening slot. Base rent is shown separately from utilities.", monthlyPriceEur: 210, priceBasis: basis, areaSquareMeters: 30, capacity: 5, weeklySlots: [slot("thursday")], equipment: ["PA"], access: ["stair access", "shared key safe"], publicFacts: ["EUR 210 base rent", "Additional mandatory service charge"], disclosure }, providerProfile: profile("Klara Vogt", "The building administrator for several creative rooms.", "precise", "Separate base rent from mandatory charges", "Use no sales language"), privateFacts: [fact("service_charge", "A mandatory EUR 55 monthly service charge applies."), fact("monthly_total", "The complete recurring monthly total is EUR 265."), fact("deposit", "A refundable EUR 300 deposit is due only after a signed agreement.", "when_asked")], allowedTransitions: [transition("explain-total", "first_message", ["service_charge", "monthly_total"], "costs_clear"), transition("explain-deposit", "relevant_question", ["deposit"], "offer_ready")], demoTags: ["mandatory_extras", "total_cost"] }),
  scenario(6, { publicListing: { slug: "treppenhaus-sessions", ownerLabel: "Treppenhaus Hausgruppe", title: "Treppenhaus Sessions", ...place("Kreuzberg", 52.489, 13.381), description: "28 m² house-project room with a Wednesday evening slot; amplified rehearsals are established, acoustic drums require confirmation.", monthlyPriceEur: 330, priceBasis: basis, areaSquareMeters: 28, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["PA", "bass cabinet"], access: ["stairs", "shared entrance"], publicFacts: ["Drum permission not yet confirmed", "All recurring charges included"], disclosure }, providerProfile: profile("Ruth at the house group", "A resident coordinating rehearsal use with the neighbouring tenant.", "careful", "State conditions as unresolved", "Never promise neighbour approval"), privateFacts: [fact("conditional_drums", "Loud acoustic drums require the neighbouring tenant's approval, which has not been received."), fact("all_in", "EUR 330 is all-inclusive.", "initial")], allowedTransitions: [transition("state-condition", "first_message", ["conditional_drums", "all_in"], "permission_pending")], demoTags: ["conditional_drums", "unresolved"] }),
  scenario(7, { publicListing: { slug: "suedstern-frequenz", ownerLabel: "Leo at Südstern Frequenz", title: "Südstern Frequenz", ...place("Kreuzberg", 52.489, 13.407), description: "34 m² production room with a Wednesday evening band slot and strong acoustic isolation.", monthlyPriceEur: 360, priceBasis: basis, areaSquareMeters: 34, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["PA", "studio monitors"], access: ["lift", "keycard"], publicFacts: ["Loud drums allowed during slot", "No overnight instrument storage"], disclosure }, providerProfile: profile("Leo Martens", "A busy producer subletting unused evening blocks.", "busy", "Answer in two or three sentences", "Be clear about storage"), privateFacts: [fact("no_storage", "All instruments, including drums, must leave after every rehearsal."), fact("all_in", "EUR 360 is all-inclusive.", "initial")], allowedTransitions: [transition("state-storage-conflict", "first_message", ["no_storage", "all_in"], "conflict_known", true)], demoTags: ["storage_conflict", "drums"] }),
  scenario(8, { publicListing: { slug: "gleisbogen", ownerLabel: "Gleisbogen Kollektiv", title: "Gleisbogen", ...place("Schöneberg", 52.486, 13.349), description: "42 m² collective room with a fixed Wednesday evening slot, storage and shared equipment.", monthlyPriceEur: 390, priceBasis: basis, areaSquareMeters: 42, capacity: 6, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "PA", "amps"], access: ["own key", "lockable storage"], publicFacts: ["Twelve-month minimum term", "All recurring charges included"], disclosure }, providerProfile: profile("Nora from Gleisbogen", "A member of a self-managed rehearsal collective.", "warm", "Explain collective rules calmly", "Never accept the term for the musician"), privateFacts: [fact("minimum_term", "The agreement has a binding twelve-month minimum term."), fact("all_in", "EUR 390 is the full monthly total.", "initial")], allowedTransitions: [transition("surface-term", "first_message", ["minimum_term", "all_in"], "musician_decision_needed")], demoTags: ["minimum_term", "human_decision"] }),
  scenario(9, { publicListing: { slug: "morgenmodul", ownerLabel: "Ben at Morgenmodul", title: "Morgenmodul", ...place("Friedrichshain", 52.507, 13.454), description: "36 m² daylight room with a weekly Wednesday morning slot.", monthlyPriceEur: 290, priceBasis: basis, areaSquareMeters: 36, capacity: 5, weeklySlots: [slot("wednesday", "09:00", "13:00")], equipment: ["PA", "piano"], access: ["lift"], publicFacts: ["Morning slot only", "Acoustic drums allowed"], disclosure }, providerProfile: profile("Ben Okafor", "A pianist who uses the room on evenings and weekends.", "warm", "Offer only the listed morning time", "Do not imply evening availability"), privateFacts: [fact("morning_only", "Only Wednesday 09:00–13:00 is available."), fact("no_evenings", "No evening alternative is available this season.")], allowedTransitions: [transition("confirm-time-conflict", "first_message", ["morning_only", "no_evenings"], "schedule_conflict", true)], demoTags: ["schedule_conflict"] }),
  scenario(10, { publicListing: { slug: "rollfeld-drei", ownerLabel: "Rollfeld Musikprojekt", title: "Rollfeld Drei", ...place("Neukölln", 52.480, 13.430), description: "18 m² rehearsal room intended for solo artists, duos and compact trios.", monthlyPriceEur: 340, priceBasis: basis, areaSquareMeters: 18, capacity: 3, weeklySlots: [slot("wednesday")], equipment: ["small PA"], access: ["ground floor"], publicFacts: ["Maximum three musicians", "Drums allowed"], disclosure }, providerProfile: profile("Samira Klein", "A vocalist running a compact neighbourhood music project.", "practical", "State the capacity early", "Do not make exceptions to fire-safety capacity"), privateFacts: [fact("capacity", "The fire-safety maximum is three people."), fact("no_exception", "A four-person band cannot use this room together.")], allowedTransitions: [transition("state-capacity-conflict", "first_message", ["capacity", "no_exception"], "capacity_conflict", true)], demoTags: ["capacity_conflict"] }),
  scenario(11, { publicListing: { slug: "leisetreter", ownerLabel: "Leisetreter", title: "Leisetreter", ...place("Neukölln", 52.475, 13.447), description: "24 m² low-volume room for electronic setups, vocals and headphone rehearsals.", monthlyPriceEur: 280, priceBasis: basis, areaSquareMeters: 24, capacity: 4, weeklySlots: [slot("wednesday")], equipment: ["electronic drum kit", "headphone mixer", "vocal PA"], access: ["keycard"], publicFacts: ["No acoustic drums", "Electronic drums available"], disclosure }, providerProfile: profile("Mika Tran", "Part of an electronic duo sharing a quiet production room.", "precise", "Distinguish acoustic from electronic drums"), privateFacts: [fact("no_acoustic_drums", "Acoustic drums are prohibited."), fact("electronic_only", "The supplied electronic kit may be used with headphones.")], allowedTransitions: [transition("state-drum-conflict", "first_message", ["no_acoustic_drums", "electronic_only"], "equipment_conflict", true)], demoTags: ["drum_conflict"] }),
  scenario(12, { publicListing: { slug: "westakkord", ownerLabel: "Inez at Westakkord", title: "Westakkord", ...place("Schöneberg", 52.486, 13.349), description: "40 m² room at the monthly budget edge, with Wednesday evening access, storage and a house kit.", monthlyPriceEur: 400, priceBasis: basis, areaSquareMeters: 40, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "PA", "two amps"], access: ["own key", "lockable storage"], publicFacts: ["All recurring charges included", "Loud drums allowed"], disclosure }, providerProfile: profile("Inez Walter", "A drummer who manages the room around her own band's weekend rehearsals.", "warm", "Be transparent that the price is firm"), privateFacts: [fact("all_in", "EUR 400 is all-inclusive and firm.", "initial"), fact("storage", "One full kit and two instrument cases may remain locked inside.")], allowedTransitions: [transition("confirm-budget-edge", "first_message", ["all_in"], "questions_open"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["budget_edge_fit", "storage"] }),
  scenario(13, { publicListing: { slug: "werkhalle-takt", ownerLabel: "Dario at Werkhalle Takt", title: "Werkhalle Takt", ...place("Moabit", 52.530, 13.344), description: "45 m² accessible room beside a repair workshop, available Thursday evenings.", monthlyPriceEur: 320, priceBasis: basis, areaSquareMeters: 45, capacity: 6, weeklySlots: [slot("thursday")], equipment: ["PA", "drum riser"], access: ["step-free entrance", "wide loading door"], publicFacts: ["Acoustic drums allowed", "All recurring charges included"], disclosure }, providerProfile: profile("Dario Nguyen", "A repair technician who shares the building with several music rooms.", "practical", "Mention step-free access when relevant"), privateFacts: [fact("all_in", "EUR 320 is all-inclusive.", "initial"), fact("access", "The route from pavement to room is step-free."), fact("storage", "A kit may remain on the drum riser.")], allowedTransitions: [transition("confirm-basics", "first_message", ["all_in"], "questions_open"), transition("confirm-access", "relevant_question", ["access", "storage"], "offer_ready")], demoTags: ["accessible", "cooperative_fit"] }),
  scenario(14, { publicListing: { slug: "nordstrom-probe", ownerLabel: "Nordstrom Verein", title: "Nordstrom Probe", ...place("Wedding", 52.550, 13.365), description: "33 m² association room with Wednesday evening availability. Heating and electricity are usage-based.", monthlyPriceEur: 280, priceBasis: basis, areaSquareMeters: 33, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["PA"], access: ["shared key"], publicFacts: ["EUR 280 base rent", "Usage-based energy costs"], disclosure }, providerProfile: profile("Emil from Nordstrom", "A volunteer maintaining a small non-profit rehearsal association.", "careful", "Never estimate unknown energy costs"), privateFacts: [fact("unknown_total", "The total recurring monthly price is unknown because energy is billed by usage."), fact("base_only", "EUR 280 is base rent only.", "initial")], allowedTransitions: [transition("state-unknown-total", "first_message", ["base_only", "unknown_total"], "cost_clarification_needed")], demoTags: ["unknown_total"] }),
  scenario(15, { publicListing: { slug: "gartenpegel", ownerLabel: "Elif at Gartenpegel", title: "Gartenpegel", ...place("Pankow", 52.569, 13.402), description: "44 m² garden-level room with a Wednesday evening slot, house drum kit and storage.", monthlyPriceEur: 360, priceBasis: basis, areaSquareMeters: 44, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "upright piano", "PA"], access: ["garden-level entrance", "storage cupboard"], publicFacts: ["All recurring charges included"], disclosure }, providerProfile: profile("Elif Kaya", "A pianist coordinating weekday use of a shared garden-level room.", "warm", "Let RoomScout decide distance suitability"), privateFacts: [fact("all_in", "EUR 360 is all-inclusive.", "initial"), fact("storage", "A drum kit may remain in the room.")], allowedTransitions: [transition("confirm-details", "first_message", ["all_in"], "questions_open"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["radius_case", "drums"] }),
  scenario(16, { publicListing: { slug: "ostschleife", ownerLabel: "Kai at Ostschleife", title: "Ostschleife", ...place("Lichtenberg", 52.515, 13.490), description: "37 m² treated room with a Wednesday evening slot and space for five musicians.", monthlyPriceEur: 300, priceBasis: basis, areaSquareMeters: 37, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "monitor wedges"], access: ["freight lift", "lockable room"], publicFacts: ["Bring your own PA", "Drum storage included"], disclosure }, providerProfile: profile("Kai Richter", "A sound technician keeping the room deliberately simple and reliable.", "precise", "State missing equipment clearly"), privateFacts: [fact("bring_pa", "The band must bring its own PA."), fact("storage", "The house kit or one private kit may remain."), fact("all_in", "EUR 300 is all-inclusive.", "initial")], allowedTransitions: [transition("confirm-details", "first_message", ["all_in", "bring_pa"], "questions_open"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["radius_case", "missing_equipment"] }),
  scenario(17, { publicListing: { slug: "transitspur", ownerLabel: "Transitspur", title: "Transitspur", ...place("Alt-Treptow", 52.492, 13.459), description: "29 m² touring-musician room with a Thursday evening slot and drum-friendly setup.", monthlyPriceEur: 345, priceBasis: basis, areaSquareMeters: 29, capacity: 4, weeklySlots: [slot("thursday")], equipment: ["drum kit", "PA"], access: ["loading zone for drop-off", "own key"], publicFacts: ["No reserved van parking", "All recurring charges included"], disclosure }, providerProfile: profile("Liv and Robin", "Two touring musicians sharing their room on a fixed weekday.", "practical", "Distinguish loading from parking"), privateFacts: [fact("no_parking", "There is no reserved or guaranteed van parking."), fact("loading", "Short loading stops are possible at the entrance."), fact("all_in", "EUR 345 is all-inclusive.", "initial")], allowedTransitions: [transition("confirm-details", "first_message", ["all_in"], "questions_open"), transition("explain-parking", "relevant_question", ["no_parking", "loading"], "offer_ready")], demoTags: ["parking_tradeoff"] }),
  scenario(18, { publicListing: { slug: "waldpuls", ownerLabel: "Waldpuls Rooms", title: "Waldpuls", ...place("Plänterwald", 52.480, 13.474), description: "31 m² room advertised with a Wednesday evening slot and basic backline.", monthlyPriceEur: 310, priceBasis: basis, areaSquareMeters: 31, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "PA"], access: ["key safe"], publicFacts: ["Availability must be reconfirmed", "All recurring charges included"], disclosure }, providerProfile: profile("Paul Neumann", "An overbooked operator who updates availability as soon as he learns it changed.", "busy", "Apologise once", "Do not negotiate a withdrawn slot"), privateFacts: [fact("withdrawn", "The advertised Wednesday slot has already been taken."), fact("no_alternative", "No comparable evening slot is currently available.")], allowedTransitions: [transition("withdraw-room", "first_message", ["withdrawn", "no_alternative"], "withdrawn", true)], demoTags: ["withdrawn_room"] }),
  scenario(19, { publicListing: { slug: "westfenster", ownerLabel: "Westfenster Studio", title: "Westfenster", ...place("Charlottenburg", 52.510, 13.304), description: "48 m² professionally maintained room with Wednesday evening availability and secure storage.", monthlyPriceEur: 430, priceBasis: basis, areaSquareMeters: 48, capacity: 6, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "PA", "amps"], access: ["own key", "secure storage"], publicFacts: ["All recurring charges included", "Price is firm"], disclosure }, providerProfile: profile("Westfenster team", "A small studio team with a straightforward rental process.", "precise", "Never pressure a budget increase"), privateFacts: [fact("all_in", "EUR 430 is all-inclusive and firm.", "initial"), fact("storage", "Secure storage is included.")], allowedTransitions: [transition("state-price", "first_message", ["all_in"], "budget_mismatch"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["near_budget_400", "good_otherwise"] }),
  scenario(20, { publicListing: { slug: "schichtwechsel", ownerLabel: "Mats at Schichtwechsel", title: "Schichtwechsel", ...place("Siemensstadt", 52.540, 13.270), description: "40 m² shared band room with a Thursday evening opening and a resident drum kit.", monthlyPriceEur: 300, priceBasis: basis, areaSquareMeters: 40, capacity: 6, weeklySlots: [slot("thursday")], equipment: ["drum kit", "PA"], access: ["keycard"], publicFacts: ["Tuesday unavailable", "Thursday 18:00–22:00 offered"], disclosure }, providerProfile: profile("Mats Vogel", "A shift worker and guitarist coordinating the room calendar.", "warm", "Offer Thursday once", "Leave schedule choice to the band"), privateFacts: [fact("tuesday_unavailable", "Tuesday evening is unavailable."), fact("thursday_offer", "Thursday 18:00–22:00 is available."), fact("all_in", "EUR 300 is all-inclusive.", "initial")], allowedTransitions: [transition("offer-alternative", "first_message", ["tuesday_unavailable", "thursday_offer", "all_in"], "musician_decision_needed")], demoTags: ["schedule_alternative", "human_decision"] }),
  scenario(21, { publicListing: { slug: "nordresonanz", ownerLabel: "Nordresonanz e.V.", title: "Nordresonanz", ...place("Reinickendorf", 52.579, 13.333), description: "36 m² youth-music association room with Wednesday evening availability and drums permitted.", monthlyPriceEur: 260, priceBasis: basis, areaSquareMeters: 36, capacity: 5, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "PA"], access: ["shared association key"], publicFacts: ["Storage confirmation pending", "All recurring charges included"], disclosure }, providerProfile: profile("Jule at Nordresonanz", "A volunteer coordinating rooms for a youth music association.", "careful", "Do not imply storage is approved"), privateFacts: [fact("storage_unknown", "Lockable overnight storage still needs committee confirmation."), fact("all_in", "EUR 260 is all-inclusive.", "initial")], allowedTransitions: [transition("state-unknown-storage", "first_message", ["all_in", "storage_unknown"], "storage_pending")], demoTags: ["storage_unknown", "radius_case"] }),
  scenario(22, { publicListing: { slug: "seetakt", ownerLabel: "Dana at Seetakt", title: "Seetakt", ...place("Weißensee", 52.556, 13.466), description: "39 m² shared room with a weekly Wednesday evening block; exact start time is confirmed in conversation.", monthlyPriceEur: 325, priceBasis: basis, areaSquareMeters: 39, capacity: 5, weeklySlots: [slot("wednesday", "19:00", "22:00")], equipment: ["drum kit", "PA"], access: ["own key"], publicFacts: ["Current slot starts at 19:00", "All recurring charges included"], disclosure }, providerProfile: profile("Dana Schulz", "An organiser scheduling several bands across two rooms.", "precise", "Correct the earlier time explicitly", "Use only the latest time afterward"), privateFacts: [fact("corrected_time", "The correct slot is Wednesday 19:00–22:00; an earlier 18:00 statement was wrong."), fact("all_in", "EUR 325 is all-inclusive.", "initial")], allowedTransitions: [transition("correct-time", "first_message", ["corrected_time", "all_in"], "time_corrected")], demoTags: ["corrected_fact", "radius_case"] }),
  scenario(23, { publicListing: { slug: "modul-ost", ownerLabel: "Modul Ost Werkstatt", title: "Modul Ost", ...place("Marzahn", 52.545, 13.558), description: "55 m² non-profit workshop room with a Wednesday evening slot and ample loud-band capacity.", monthlyPriceEur: 220, priceBasis: basis, areaSquareMeters: 55, capacity: 7, weeklySlots: [slot("wednesday")], equipment: ["drum kit", "basic PA"], access: ["freight lift", "shared key"], publicFacts: ["All recurring charges included"], disclosure }, providerProfile: profile("Anja at Modul Ost", "A workshop coordinator keeping a large community room affordable.", "warm", "Be factual about the longer journey"), privateFacts: [fact("all_in", "EUR 220 is all-inclusive.", "initial"), fact("storage", "A drum kit may remain in a shared marked area.")], allowedTransitions: [transition("confirm-details", "first_message", ["all_in"], "questions_open"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["large_radius", "low_price"] }),
  scenario(24, { publicListing: { slug: "uferklang", ownerLabel: "Uferklang", title: "Uferklang", ...place("Köpenick", 52.445, 13.575), description: "46 m² riverside-area room with a Thursday evening slot, own key and lockable storage.", monthlyPriceEur: 375, priceBasis: basis, areaSquareMeters: 46, capacity: 5, weeklySlots: [slot("thursday")], equipment: ["drum kit", "PA", "bass cabinet"], access: ["own key", "lockable storage"], publicFacts: ["All recurring charges included"], disclosure }, providerProfile: profile("Mila and Tom", "A musician couple sharing their room on the evening their band is off.", "warm", "Be clear that travel distance is for the musician to judge"), privateFacts: [fact("all_in", "EUR 375 is all-inclusive.", "initial"), fact("storage", "Lockable storage for one kit is included.")], allowedTransitions: [transition("confirm-details", "first_message", ["all_in"], "questions_open"), transition("confirm-storage", "relevant_question", ["storage"], "offer_ready")], demoTags: ["large_radius", "storage"] }),
] as const;

export const LEGACY_STUTTGART_PROVIDER_SCENARIO: BerlinProviderScenarioDefinition = {
  schemaVersion: 1, scenarioId: "STU-LEGACY-01", version: 1, seedKey: "berlin-demo-v1:STU-LEGACY-01",
  publicListing: { title: "Spare Rehearsal Room", city: "Stuttgart", description: "Rehearsal room for bands of up to five members.", imageUrl: "https://roomscout.dev/demo-rooms/spare-rehearsal-room-stuttgart.webp", priceEur: 350, pricePeriod: "month", publicFactIds: ["price_monthly", "slot_tuesday", "capacity", "drum_kit", "storage"] },
  providerProfile: { fictionalName: "Alex from the rehearsal room", shortBackstory: { en: "A Stuttgart drummer sharing a well-kept room with another band.", de: "Ein Stuttgarter Schlagzeuger, der einen gepflegten Raum mit einer weiteren Band teilt." }, tone: { en: "Friendly, practical and direct.", de: "Freundlich, praktisch und direkt." } },
  facts: [
    { id: "price_monthly", visibility: "public", disclosure: "public", kind: "price", amountEur: 350, cadence: "month", component: "total", recurringCostsKnown: true },
    { id: "slot_tuesday", visibility: "public", disclosure: "public", kind: "slot", weekday: "tuesday", startTime: "18:00", endTime: "22:00", status: "available" },
    { id: "capacity", visibility: "public", disclosure: "public", kind: "capacity", maximumPeople: 5 },
    { id: "drum_kit", visibility: "public", disclosure: "public", kind: "feature", feature: "drum_kit", status: "provided" },
    { id: "storage", visibility: "public", disclosure: "public", kind: "feature", feature: "storage", status: "provided" },
    { id: "contract_start", visibility: "private", disclosure: "on_request", kind: "term", term: "other", value: { en: "The slot can start on the first of October 2026.", de: "Der Slot kann zum ersten Oktober 2026 starten." } },
    { id: "contract_minimum", visibility: "private", disclosure: "on_request", kind: "term", term: "minimum_commitment", value: { en: "The minimum commitment is three months.", de: "Die Mindestlaufzeit beträgt drei Monate." } },
    { id: "contract_notice", visibility: "private", disclosure: "on_request", kind: "term", term: "notice_period", value: { en: "Cancellation requires one full calendar month's notice to month-end.", de: "Die Kündigungsfrist beträgt einen vollen Kalendermonat zum Monatsende." } },
    { id: "viewing_path", visibility: "private", disclosure: "when_relevant", kind: "term", term: "other", value: { en: "A viewing can be arranged before the start date; minor remaining contract details can be confirmed there.", de: "Eine Besichtigung kann vor dem Starttermin vereinbart werden; kleinere übrige Vertragsdetails können dort geklärt werden." } },
  ],
  catalog: { slug: "spare-rehearsal-room-stuttgart", ownerLabel: "Room provider", street: "Stuttgart", latitude: 48.7758, longitude: 9.1829, locationPrecision: "approximate_fictional", areaSquareMeters: 30, capacity: 5, weeklySlots: [{ weekday: "tuesday", start: "18:00", end: "22:00" }], equipment: ["drum kit"], access: ["secure storage"], disclosure, demoTags: ["legacy_stuttgart"] },
};

export type PublicProviderScenario = Pick<BerlinProviderScenarioDefinition, "schemaVersion" | "scenarioId" | "version" | "seedKey" | "publicListing" | "catalog">;

export function publicScenarioProjection(scenarioDefinition: BerlinProviderScenarioDefinition): PublicProviderScenario {
  return {
    schemaVersion: scenarioDefinition.schemaVersion,
    scenarioId: scenarioDefinition.scenarioId,
    version: scenarioDefinition.version,
    seedKey: scenarioDefinition.seedKey,
    publicListing: structuredClone(scenarioDefinition.publicListing),
    catalog: structuredClone(scenarioDefinition.catalog),
  };
}

export function getBerlinProviderScenario(scenarioId: string, version: number = BERLIN_CATALOG_VERSION): BerlinProviderScenarioDefinition | undefined {
  if (scenarioId === LEGACY_STUTTGART_PROVIDER_SCENARIO.scenarioId && version === LEGACY_STUTTGART_PROVIDER_SCENARIO.version) return LEGACY_STUTTGART_PROVIDER_SCENARIO;
  return BERLIN_PROVIDER_SCENARIOS.find((candidate) => candidate.scenarioId === scenarioId && candidate.version === version);
}

export function validateBerlinProviderCatalog(catalog: readonly BerlinProviderScenarioDefinition[] = BERLIN_PROVIDER_SCENARIOS): void {
  if (catalog.length !== 24) throw new Error("BERLIN_CATALOG_MUST_HAVE_24_SCENARIOS");
  const ids = new Set<string>();
  const seedKeys = new Set<string>();
  const slugs = new Set<string>();
  for (const item of catalog) {
    if (ids.has(item.scenarioId) || seedKeys.has(item.seedKey) || slugs.has(item.catalog.slug)) throw new Error("BERLIN_CATALOG_DUPLICATE_IDENTITY");
    ids.add(item.scenarioId); seedKeys.add(item.seedKey); slugs.add(item.catalog.slug);
    if (item.schemaVersion !== 1 || item.version !== BERLIN_CATALOG_VERSION) throw new Error("BERLIN_CATALOG_VERSION_MISMATCH");
    if (item.publicListing.city !== "Berlin" || item.publicListing.pricePeriod !== "month" || item.catalog.locationPrecision !== "approximate_fictional") throw new Error("BERLIN_CATALOG_PUBLIC_CONTRACT_INVALID");
    if (!Number.isFinite(item.publicListing.priceEur) || (item.publicListing.priceEur ?? 0) <= 0 || item.catalog.weeklySlots.length === 0) throw new Error("BERLIN_CATALOG_LISTING_INVALID");
    const factIds = new Set(item.facts.map((privateFact) => privateFact.id));
    if (factIds.size !== item.facts.length) throw new Error("BERLIN_CATALOG_PRIVATE_CONTRACT_INVALID");
  }
  for (const requiredId of ["BER-01", "BER-02", "BER-03", "BER-04"]) if (!ids.has(requiredId)) throw new Error("BERLIN_CATALOG_DEMO_PATH_MISSING");
  const budgetPath = catalog.find((item) => item.scenarioId === "BER-04");
  if (budgetPath?.publicListing.priceEur !== 320 || !budgetPath.catalog.demoTags.includes("budget_250_to_400")) throw new Error("BERLIN_CATALOG_BUDGET_PATH_INVALID");
}

validateBerlinProviderCatalog();
