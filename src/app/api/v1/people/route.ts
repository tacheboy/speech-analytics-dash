import { jsonBody, queryObject, route } from "@/server/http";
import { createPerson, listPeople } from "@/server/services/people";

/** GET /api/v1/people */
export const GET = route(async (req, actor) => listPeople(actor, queryObject(req.url)));

/** POST /api/v1/people: upsert on externalId / email (201 created, 200 matched) */
export const POST = route(async (req, actor) => {
  const { person, created } = await createPerson(actor, await jsonBody(req));
  return Response.json(person, { status: created ? 201 : 200 });
});
