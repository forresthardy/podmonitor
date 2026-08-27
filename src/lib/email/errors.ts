/** Base error for any email provider failure — network, non-2xx, or an SMTP transport error. */
export class EmailProviderError extends Error {
  readonly provider: string
  readonly status?: number

  constructor(message: string, provider: string, status?: number) {
    super(message)
    this.name = 'EmailProviderError'
    this.provider = provider
    if (status !== undefined) this.status = status
  }
}
