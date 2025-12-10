export const waitUntil = (promise: Promise<any>) => {
  // Mock implementation: just float the promise
  promise.catch(console.error)
}
