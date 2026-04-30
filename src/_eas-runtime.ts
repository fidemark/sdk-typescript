// eas-sdk v2.9.0 ships a broken ESM build (extensionless relative imports).
// Force CJS resolution via createRequire so Node ESM consumers don't blow up.
import { createRequire } from "node:module";
import type {
  EAS as EASType,
  SchemaEncoder as SchemaEncoderType,
  Offchain as OffchainType,
  OffchainAttestationVersion as OffchainAttestationVersionType,
  Delegated as DelegatedType,
} from "@ethereum-attestation-service/eas-sdk";

const requireCjs = createRequire(import.meta.url);
const easSdk = requireCjs("@ethereum-attestation-service/eas-sdk");

export const EAS: typeof EASType = easSdk.EAS;
export const SchemaEncoder: typeof SchemaEncoderType = easSdk.SchemaEncoder;
export const Offchain: typeof OffchainType = easSdk.Offchain;
export const OffchainAttestationVersion: typeof OffchainAttestationVersionType =
  easSdk.OffchainAttestationVersion;
export const Delegated: typeof DelegatedType = easSdk.Delegated;
