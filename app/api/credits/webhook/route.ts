import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { addCreditsToUser } from "../../../lib/firebase-admin";

const PACKS: Record<string, number> = {
  starter: 20,
  value: 60,
  pro: 150,
  mega: 500,
};

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = new Stripe(secret);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const uid = session.metadata?.uid;
  const packId = session.metadata?.packId;
  const packCredits = session.metadata?.packCredits;

  const credits = packCredits ? parseInt(packCredits, 10) : (packId ? PACKS[packId] : 0);
  if (!uid || !credits || isNaN(credits)) {
    return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
  }

  const ok = await addCreditsToUser(uid, credits);
  if (!ok) {
    return NextResponse.json({ error: "Failed to add credits" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
