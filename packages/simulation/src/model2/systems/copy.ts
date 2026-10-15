// Internal contracts contain JSON values, never buffers, Dates, Maps or functions.
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
