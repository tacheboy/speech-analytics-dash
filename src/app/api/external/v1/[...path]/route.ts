import { errorResponse } from "@/server/external/http";

/** Unknown external API paths get the documented `{ error }` shape instead of an HTML 404. */
const notFound = async () => errorResponse(404, "Not found");
export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
