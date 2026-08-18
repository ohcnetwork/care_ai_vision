export {
  extractDataFromImage,
  extractLabResults,
  buildLabFieldSpecs,
} from "./care-ai";
export type { LabFieldKeyMap, LabFieldTarget } from "./care-ai";
export { resolveGeoOrganization } from "./governance";
export {
  BLOOD_GROUP_MAP,
  highlightField,
  highlightLabObservation,
  normalizeBloodGroup,
  normalizeIsoDate,
  normalizePhone,
  normalizePincode,
} from "./utils";
export type { ExtractedData, GovtOrg } from "./types";
