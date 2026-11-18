// Explicit integration-test profiles, not product policy or model-quality claims.
// Keep the historical CPU configuration as the default. The smaller GPU context
// fits the measured ~4.7k-token two-read fixture; it is not a general coding profile.
export function codexInferenceProfile(name = 'cpu-32k') {
  if (name === 'cpu-32k') return { name, context: 32768, compact: 24000, gpu: false, memoryBytes: 12 * 1024 ** 3 };
  if (name === 'gpu-8k') return { name, context: 8192, compact: 6500, gpu: true, memoryBytes: 6 * 1024 ** 3 };
  throw Error('Unknown Codex inference profile: ' + name);
}
