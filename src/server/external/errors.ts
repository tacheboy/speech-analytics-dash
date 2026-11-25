/** External API errors are always `{ "error": "<message>" }`. */
export class ExternalError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
