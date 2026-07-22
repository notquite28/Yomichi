export async function initLlama() {
  throw new Error('llama.rn mock: initLlama should not be called in unit tests');
}

export async function releaseAllLlama() {}

export class LlamaContext {
  async completion() {
    return { text: '', content: '', tokens_predicted: 0, timings: { predicted_per_second: 0 } };
  }
  async stopCompletion() {}
  async clearCache() {}
  async release() {}
}
