// Compose's Docker config directory does not control dotenv discovery. Apply
// this at the child-process boundary in every local Compose launcher.
export function composeEnvironment(inherited) {
  const selectors = new Set([
    "COMPOSE_ENV_FILES",
    "COMPOSE_DISABLE_ENV_FILE",
    "COMPOSE_FILE",
    "COMPOSE_PROFILES",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(inherited).filter(
        ([key]) => !selectors.has(key.toUpperCase()),
      ),
    ),
    COMPOSE_DISABLE_ENV_FILE: "true",
  };
}
