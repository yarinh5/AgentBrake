export function verifyImageBinding(candidate, name, imageId) {
  const roles = { runtime: 'gateway', dashboard: 'dashboard', postgres: 'control-db', opa: 'opa' };
  if (!Object.hasOwn(roles, name) || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Invalid candidate image identity');
  const container = `agentbrake-product-verify-candidate-${candidate.runId.slice(0, 8)}-${roles[name]}-1`;
  const exercised = candidate.images.find(image => image.ContainerName === container);
  if (!exercised || exercised.ID !== imageId) throw Error('Image changed since candidate acceptance; rebuild/reverify before scanning');
  return true;
}
