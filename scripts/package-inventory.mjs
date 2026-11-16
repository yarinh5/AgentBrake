// Shared with the source-package regression/staging check; release gating stays
// in package-release.mjs and cannot be bypassed by selecting the inventory.
export function packageFilePaths(source) {
  return [
    ...source.files.map((f) => f.path),
    "README.md",
    "docs/LOCAL_PRODUCT_OPERATIONS.md",
    "docs/SERVICE_OPERATIONS.md",
    "docs/SERVICE_DESIGN.md",
    "docs/KNOWN_LIMITATIONS.md",
    "docs/TEST_MATRIX.md",
    "docs/SECURITY_EVIDENCE.md",
    "docs/PRODUCTION_OPERATIONS.md",
    "docs/PRODUCTION_READINESS.md",
    "docs/PLAN_PRODUCTION.md",
    "docs/ADR/0005-production-candidate.md",
    "docs/ADR/0006-minimal-runtime-images.md",
    "docs/evidence/local-release.json",
  ];
}
