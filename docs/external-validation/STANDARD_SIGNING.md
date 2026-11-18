# Local standard signing validation

Final-source update, 2026-11-17: source `2d8df354e16dacbdda4802a04dd875d6166f053f63a5a3b897a2bf41d358032e`, archive SHA-256 `89d6f75d33a8809429606ae635a5d765c8f72d83f4fe5e62801beac5922ce6d4`. Offline Cosign3.1.4 passed all14 positive/negative signing and SLSA-v1-format attestation checks in `evidence/standard-signing-a2205fb7-edd1-46ae-b357-bb3140999427/`. A second network-disabled, read-only consumer verified the attestation using only the selected public key, bundle, archive and pinned tool. The key is synthetic and disposable; this proves artifact binding and verifier behavior, not organizational identity, transparency, trusted CI or any SLSA level.

Final-source continuation:6c5db3b91a0c, archiveSHA2560f9e2300fc830172d0a136e679c83331641bc03a7939c6204e6963f566d7edfa. All14 steps and separate readonly/no-network consumer verification pass again in ../evidence/standard-signing-e950bc11-7411-4e10-b808-a09eb34c439e. Earlier e972 proof below is preserved; neither bundle establishes organizational signer trust.

2026-11-17, C08 engineering evidence only. Cosign3.1.4, official Linux amd64 binary SHA256 `424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa`, checked against the [official release assets](https://github.com/sigstore/cosign/releases/expanded_assets/v3.1.4). Download integrity is not an independently verified signer identity for the Cosign binary.

The release archive for source `e9722202db98dfa5804f39c12f8761455f62cb08e1c44c303455b93a08aa3677` has SHA256 `16176d343db820849eb111b13df70f59bae545db3623aad41cd0cb3a108a8bfa`. Full local release, Enterprise, audit/image gates passed before packaging. All275 packaged files and their source hashes were checked. This is still an evaluation candidate, not Production acceptance.

Actual evidence: [standard-signing-aaa68603-841a-4975-a9ef-6d64cff3209c](../evidence/standard-signing-aaa68603-841a-4975-a9ef-6d64cff3209c/summary.json). Fourteen CLI steps passed, including signature/attestation positives and rejection of altered archive, wrong public key, missing bundle, altered signature, wrong subject and wrong predicate type. A second disposable container verified the attestation with only readonly public material after the signing container terminated. The replayable fixture, exact arguments, exit codes, public keys, bundles, decoded statement, predicate and logs are preserved there.

All signing/verification ran as UID1000 in network-none, readonly, capability-free containers. The fresh encrypted synthetic private keys/password existed only in temporary container memory/tmpfs; only public material was exported. No existing organization key, keyless login, KMS, Fulcio, timestamp service, registry or transparency log was used. The tool generated an empty service configuration. No artifact was uploaded.

The attestation is the standard Cosign Sigstore bundle/DSSE/in-toto format with SLSA provenance-v1 predicate. It describes local source-archive assembly, identifies the local development builder as untrusted, and binds the source manifest and the hashes of the actual release/image/package reports. It does not claim a hosted CI build, independent builder, reproducible binary, complete hermetic dependencies or any SLSA level. The underlying development operator can rewrite source and reports; signing cannot remove that trust assumption.

To independently verify this **test** bundle using the separately selected public key:

```text
cosign verify-blob --key fixture.pub --bundle archive.sigstore.json --insecure-ignore-tlog archive.tar.gz
cosign verify-blob-attestation --key fixture.pub --bundle provenance.sigstore.json --type slsaprovenance1 --insecure-ignore-tlog archive.tar.gz
```

`--insecure-ignore-tlog` is deliberate for the local private-key test: no public inclusion proof exists. It does not turn off signature or subject checks; the actual negative controls demonstrate both. Do not adopt an arbitrary public key supplied alongside an untrusted download as an organization trust root. A commercial release needs separately distributed/approved signer identity, protected custody/rotation/revocation, reviewed build provenance and consumer policy that checks builder, source and required reports, not just valid signature syntax. Keyless CI/public transparency would require explicit publication authorization and a separately tested workflow.

This standard-tool path replaces the proposed use of the project's custom archive-signing protocol for future commercial delivery. Existing custom-signing code is retained for compatibility and its existing tests; it is not relabeled organizational provenance.

References: [Cosign blob signing](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/), [verification](https://docs.sigstore.dev/cosign/verifying/verify/), [SLSA provenance and verification](https://slsa.dev/spec/v1.2/verifying-artifacts). Customer/operator trust acceptance is still open.

Delivery scope: the tested bundle signs the source installation archive and a local assembly provenance statement. It is not an OCI registry-image signature or an enforced admission policy for downloaded runtime images. Four actual candidate image IDs and scans are separately bound by report hashes; commercial image distribution/signatures, organizational trust-root rollout and consumer policy remain C08 acceptance work. No registry publication was authorized or performed.
