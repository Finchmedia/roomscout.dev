import { auth } from "@clerk/nextjs/server";
import { createListingAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  await auth.protect();
  return <main className="narrow"><p className="eyebrow">Authenticated owner flow</p><h1>Post a listing</h1><p className="lead">This page deliberately uses a server-rendered form and a protected Server Action. Once published, the listing is visible to Firecrawl without authentication.</p><form action={createListingAction} className="form-card"><label>Public owner or band name<input name="ownerLabel" required maxLength={100} /></label><label>Listing side<select name="side" defaultValue="supply"><option value="supply">Room available</option><option value="demand">Room wanted</option></select></label><label>Title<input name="title" required maxLength={180} /></label><div className="form-row"><label>City<input name="city" required maxLength={100} /></label><label>District<input name="district" maxLength={100} /></label></div><label>Description<textarea name="description" required maxLength={5000} rows={8} /></label><div className="form-row"><label>Price in EUR<input min={0} max={100000} name="priceEur" type="number" /></label><label>Price period<select name="pricePeriod" defaultValue="month"><option value="month">Per month</option><option value="hour">Per hour</option></select></label></div><button className="button" type="submit">Publish listing</button></form></main>;
}
