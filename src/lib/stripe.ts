import Stripe from "stripe";

// Server-only. Never import this from anything that ships to the browser.
export const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY);
