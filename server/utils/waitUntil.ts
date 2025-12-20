/**
 * Gets Cloudflare Workers waitUntil if available.
 * Uses dynamic import to avoid module load errors in Node.js/dev.
 */
export async function getWaitUntil(): Promise<((promise: Promise<any>) => void) | undefined> {
  try {
    // @ts-expect-error - cloudflare:workers is only available in Workers runtime
    const pkg = 'cloudflare:workers'
    const { waitUntil } = await import(pkg)
    return waitUntil
  } catch {
    return undefined
  }
}
