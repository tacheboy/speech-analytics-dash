/** Demo receiver: point a webhook at `<origin>/api/dev/webhook-sink` to watch deliveries succeed. */
export async function POST(req: Request) {
  await req.text();
  return Response.json({ received: true });
}
