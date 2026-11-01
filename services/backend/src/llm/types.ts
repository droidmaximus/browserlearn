export interface LlmProvider {
  complete(system: string, user: string): Promise<string>;
}
