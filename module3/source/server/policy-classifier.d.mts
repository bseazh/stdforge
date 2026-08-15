export type PolicyModelConfig = {
  baseUrl?: string
  model?: string
  apiKey?: string
}

export declare function preprocessPolicy(policy: unknown): unknown

export declare function analyzePolicies(
  policies: unknown[],
  options?: { config?: PolicyModelConfig; signal?: AbortSignal },
): Promise<unknown>

