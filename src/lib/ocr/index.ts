export {
  extractDataFromImage,
  extractLabResults,
  buildLabResultsPrompt,
  extractLabResultsViaEka,
} from "./care-ai";
export { resolveGeoOrganization } from "./governance";
export { BLOOD_GROUP_MAP, normalizePhone } from "./utils";
export type { ExtractedData, GovtOrg } from "./types";
export type { EkaLabResult } from "./care-ai";
