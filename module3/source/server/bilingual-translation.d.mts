import type { PolicyModelConfig } from './policy-classifier.mjs'

export type BilingualMode = 'parallel' | 'english-only'
export type BilingualLanguage = 'zh' | 'en'
export declare const createBilingualService: (options: {
  storePath: string
  config?: PolicyModelConfig
}) => any
