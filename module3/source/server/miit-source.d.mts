export type CrawlMiitInput = {
  keywords: string[]
  startDate: string
  endDate: string
  maxPages?: number
  pageSize?: number
}

export declare function crawlMiitPolicies(
  input: CrawlMiitInput,
  options?: { signal?: AbortSignal },
): Promise<unknown>

export declare function hydrateMiitPolicyDetails(
  policy: unknown,
  options?: { signal?: AbortSignal },
): Promise<unknown>

export declare function hydrateMiitPolicies(
  policies: unknown[],
  options?: { signal?: AbortSignal },
): Promise<unknown[]>
