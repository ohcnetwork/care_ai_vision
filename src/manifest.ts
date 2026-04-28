import { lazy } from "react";

const manifest = {
  plugin: "care-ocr-fill",
  routes: {},
  extends: [],
  components: {
    PatientRegistrationForm: lazy(() => import("./components/OCRFormFill")),
  },
  devices: [],
} as const;

export default manifest;
