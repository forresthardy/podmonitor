/**
 * Minimal stand-in for the Next.js cookie store, enough for route handlers under test:
 * `get`, `set`, and `delete`. One instance represents one browser.
 */
export class FakeCookieStore {
  private readonly jar = new Map<string, string>()

  get(name: string): { name: string; value: string } | undefined {
    const value = this.jar.get(name)
    return value === undefined ? undefined : { name, value }
  }

  set(name: string, value: string): void {
    this.jar.set(name, value)
  }

  delete(name: string): void {
    this.jar.delete(name)
  }

  clear(): void {
    this.jar.clear()
  }
}
