/** An embedding backend refused or failed a request. Distinct from LLM errors so the
 *  linking job can tell "no vectors" apart from "no relation classification". */
export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'EmbeddingProviderError'
  }
}
