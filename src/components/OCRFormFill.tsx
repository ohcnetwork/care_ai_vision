import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useTranslation } from "@/hooks/useTranslation";
import {
  BLOOD_GROUP_MAP,
  ExtractedData,
  extractDataFromImage,
  fileToBase64,
  normalizePhone,
  resolveGeoOrganization,
} from "@/lib/ocr";

type Status = "idle" | "processing" | "success" | "error";

interface FormLike {
  setValue: (
    field: string,
    value: string | number | boolean,
    options?: { shouldValidate?: boolean; shouldDirty?: boolean },
  ) => void;
}

export default function OCRFormFill({
  form,
  patientId,
  __meta,
}: {
  form: FormLike;
  facilityId?: string;
  patientId?: string;
  submitForm?: () => void;
  __meta?: {
    config?: {
      REACT_APP_GEMINI_API_KEY?: string;
    };
    [key: string]: unknown;
  };
}) {
  const { t } = useTranslation();
  const GEMINI_API_KEY =
    __meta?.config?.REACT_APP_GEMINI_API_KEY ??
    import.meta.env.REACT_APP_GEMINI_API_KEY ??
    "";
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [filledFields, setFilledFields] = useState<
    { label: string; value: string }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setField = useCallback(
    (field: string, value: string | number | boolean) => {
      form.setValue(field, value, { shouldValidate: true, shouldDirty: true });
    },
    [form],
  );

  const applyData = useCallback(
    async (data: ExtractedData) => {
      const filled: { label: string; value: string }[] = [];

      if (data.name) {
        setField("name", data.name);
        filled.push({ label: "Name", value: data.name });
      }

      const phone = normalizePhone(data.phone_number);
      if (phone) {
        setField("phone_number", phone);
        filled.push({ label: "Phone", value: phone });
      }

      const emergencyPhone = normalizePhone(data.emergency_phone_number);
      if (emergencyPhone) {
        setField("emergency_phone_number", emergencyPhone);
        filled.push({ label: "Emergency Phone", value: emergencyPhone });
      }

      if (
        data.gender &&
        ["male", "female", "transgender", "non_binary"].includes(data.gender)
      ) {
        setField("gender", data.gender);
        filled.push({
          label: "Gender",
          value: data.gender.charAt(0).toUpperCase() + data.gender.slice(1),
        });
      }

      if (data.date_of_birth) {
        setField("age_or_dob", "dob");
        setField("date_of_birth", data.date_of_birth);
        filled.push({ label: "Date of Birth", value: data.date_of_birth });
      } else if (data.age) {
        setField("age_or_dob", "age");
        setField("age", Number(data.age));
        filled.push({ label: "Age", value: String(data.age) });
      }

      if (data.blood_group) {
        const mapped = BLOOD_GROUP_MAP[data.blood_group.toUpperCase()] ?? "UNK";
        setField("blood_group", mapped);
        filled.push({ label: "Blood Group", value: data.blood_group });
      }

      if (data.address) {
        setField("address", data.address);
        filled.push({ label: "Address", value: data.address });
      }

      if (data.permanent_address) {
        setField("permanent_address", data.permanent_address);
        setField("permanent_address_same_as_address", false);
        filled.push({
          label: "Permanent Address",
          value: data.permanent_address,
        });
      } else if (data.address) {
        setField("permanent_address", data.address);
        setField("permanent_address_same_as_address", true);
      }

      if (data.pincode) {
        setField("pincode", Number(data.pincode));
        filled.push({ label: "Pincode", value: String(data.pincode) });
      }

      // Resolve governance hierarchy (state → district → local body → ward)
      if (data.state || data.district || data.local_body || data.ward) {
        try {
          const geoResult = await resolveGeoOrganization(data);
          if (geoResult) {
            setField("geo_organization", geoResult.id);
            setField("_selected_levels", geoResult.levels as unknown as string);
            const locationParts = geoResult.levels
              .map((l) => l.name)
              .join(" → ");
            filled.push({ label: "Governance", value: locationParts });
          }
        } catch {
          // Governance resolution failed silently — user can select manually
        }
      }

      setFilledFields(filled);
    },
    [setField],
  );

  const processImage = useCallback(
    async (file: File) => {
      setStatus("processing");
      setError("");
      setFilledFields([]);
      setPreview(URL.createObjectURL(file));

      try {
        const base64 = await fileToBase64(file);
        const mimeType = file.type || "image/jpeg";
        const data = await extractDataFromImage(
          base64,
          mimeType,
          GEMINI_API_KEY,
        );
        await applyData(data);
        setStatus("success");
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Failed to process image";
        setError(message);
        setStatus("error");
      }
    },
    [applyData, GEMINI_API_KEY],
  );

  const handleFile = useCallback(
    (file?: File) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError(t("upload_image_error"));
        setStatus("error");
        return;
      }
      processImage(file);
    },
    [processImage, t],
  );

  const reset = () => {
    setStatus("idle");
    setError("");
    setPreview(null);
    setFilledFields([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Hide in edit mode
  if (patientId) return null;

  const isOpen = status !== "idle";

  return (
    <>
      {/* Compact trigger button */}
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        className="gap-2 border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800"
      >
        <Camera className="h-4 w-4" />
        {t("scan_registration_form")}
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />

      {/* Bottom sheet / modal overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={status !== "processing" ? reset : undefined}
          />
          {/* Sheet */}
          <Card className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl border-0 shadow-xl animate-in slide-in-from-bottom">
            {/* Close button */}
            {status !== "processing" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={reset}
                className="absolute top-3 right-3 h-8 w-8 rounded-full text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </Button>
            )}

            {status === "processing" && (
              <CardContent className="flex flex-col items-center gap-4 py-8">
                {preview && (
                  <img
                    src={preview}
                    alt="Form preview"
                    className="h-28 w-28 rounded-xl object-cover border"
                  />
                )}
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">
                    {t("extracting_details")}
                  </span>
                </div>
              </CardContent>
            )}

            {status === "success" && (
              <>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="text-green-800">
                      {t("extracted_fields", { count: filledFields.length })}
                    </span>
                    <Badge
                      variant="secondary"
                      className="bg-green-100 text-green-700 border-0 ml-auto"
                    >
                      {filledFields.length} {t("fields")}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="space-y-2">
                    {filledFields.map((f) => (
                      <div
                        key={f.label}
                        className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"
                      >
                        <span className="text-xs font-medium text-gray-500 shrink-0">
                          {f.label}
                        </span>
                        <span className="text-sm font-medium text-gray-900 text-right truncate">
                          {f.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-2">
                  <Button
                    type="button"
                    className="w-full gap-1.5"
                    onClick={reset}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("done")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-1.5"
                    onClick={() => {
                      reset();
                      fileInputRef.current?.click();
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("scan_another_form")}
                  </Button>
                </CardFooter>
              </>
            )}

            {status === "error" && (
              <>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertCircle className="h-5 w-5 text-red-600" />
                    <span className="text-red-800">{error}</span>
                  </CardTitle>
                </CardHeader>
                <CardFooter>
                  <Button
                    type="button"
                    className="w-full gap-1.5"
                    onClick={() => {
                      reset();
                      fileInputRef.current?.click();
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("try_again")}
                  </Button>
                </CardFooter>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
