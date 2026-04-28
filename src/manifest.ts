import { lazy } from "react";

const manifest = {
  plugin: "care_ai_vision_fe",
  routes: {},
  extends: [],
  components: {
    PatientRegistrationForm: lazy(() => import("./components/OCRFormFill")),
  },
  devices: [],
} as const;

export default manifest;
