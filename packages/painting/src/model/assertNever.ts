export function assertNever(x: never): never {
  throw new Error(`Unexpected drawing stroke variant: ${JSON.stringify(x)}`);
}
