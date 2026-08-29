interface ImportMetaEnv {
  readonly REACT_MEDISPEAK_API_URL: string;
  readonly REACT_LOW_CONFIDENCE_THRESHOLD?: string;
  readonly REACT_INTERPRETATION_VISION_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
