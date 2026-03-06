import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const PACKS: Record<string, { credits: number; label: string; priceUSD: number; priceINR: number }> = {
  starter: { credits: 20, label: "Starter", priceUSD: 0.99, priceINR: 79 },
  value: { credits: 60, label: "Value Pack", priceUSD: 1.99, priceINR: 149 },
  pro: { credits: 150, label: "Pro Pack", priceUSD: 3.99, priceINR: 329 },
  mega: { credits: 500, label: "Mega Pack", priceUSD: 9.99, priceINR: 799 },
};

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  let body: { packId?: string; currency?: string; uid?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packId, currency, uid } = body;
  if (!packId || !uid || typeof uid !== "string") {
    return NextResponse.json({ error: "Missing packId or uid" }, { status: 400 });
  }

  const pack = PACKS[packId];
  if (!pack) {
    return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
  }

  const isINR = currency === "inr";
  const amount = isINR ? pack.priceINR : pack.priceUSD;
  const stripeCurrency = isINR ? "inr" : "usd";
  const unitAmount = isINR ? Math.round(amount * 100) : Math.round(amount * 100);

  const origin = request.headers.get("origin") || request.nextUrl?.origin || "";
  const base = process.env.NEXT_PUBLIC_APP_URL || origin || "http://localhost:3000";
  const successUrl = `${base.replace(/\/$/, "")}/?credits=success`;
  const cancelUrl = `${base.replace(/\/$/, "")}/?credits=cancel`;

  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: stripeCurrency,
            unit_amount: unitAmount,
            product_data: {
              name: `${pack.label} – ${pack.credits} credits`,
              description: `Know Your Food – ${pack.credits} analysis credits`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        uid,
        packId,
        packCredits: String(pack.credits),
      },
    });

    const url = session.url;
    if (!url) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stripe error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
