export class InstagramExtractionError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(message: string, statusCode: number = 500, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}
