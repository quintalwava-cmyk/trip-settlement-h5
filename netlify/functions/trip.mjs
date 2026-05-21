import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function isValidId(id) {
  return /^[a-zA-Z0-9-]{8,80}$/.test(id || "");
}

export default async (request) => {
  const url = new URL(request.url);
  const store = getStore({ name: "trip-records", consistency: "strong" });

  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!isValidId(id)) return json({ error: "Invalid trip id" }, 400);

    const raw = await store.get(`trip-${id}`, { consistency: "strong" });
    if (!raw) return json({ error: "Trip not found" }, 404);

    return json({ id, trip: JSON.parse(raw) });
  }

  if (request.method === "POST") {
    const payload = await request.json().catch(() => null);
    if (!payload?.trip) return json({ error: "Missing trip payload" }, 400);

    const id = isValidId(payload.id) ? payload.id : randomUUID();
    const trip = {
      ...payload.trip,
      cloudId: id,
      updatedAt: new Date().toISOString(),
    };

    await store.set(`trip-${id}`, JSON.stringify(trip));
    return json({ id, trip });
  }

  return json({ error: "Method not allowed" }, 405);
};
