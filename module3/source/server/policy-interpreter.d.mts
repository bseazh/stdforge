import type { PolicyModelConfig } from './policy-classifier.mjs'

export type PolicyInterpretationSkill = 'policy-expert-interpretation' | 'policy-clause-analysis'

export declare function interpretPolicy(
  input: {
    policy: unknown
    skillId: PolicyInterpretationSkill
    audience: string
  },
  options?: { config?: PolicyModelConfig; signal?: AbortSignal },
): Promise<unknown>
