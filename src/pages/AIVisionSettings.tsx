import { Eye, EyeOff } from "lucide-react";
import { useAtom } from "jotai";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import useAuthUser from "@/hooks/useAuthUser";
import { useTranslation } from "@/hooks/useTranslation";
import { aiVisionEnabledAtomFor } from "@/state/ai-vision-store";

export default function AIVisionSettings() {
  const { t } = useTranslation();
  const user = useAuthUser();
  const enabledAtom = useMemo(
    () => aiVisionEnabledAtomFor(user.id ?? user.username),
    [user.id, user.username],
  );
  const [enabled, setEnabled] = useAtom(enabledAtom);

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">{t("ai_vision_settings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {enabled ? (
              <Eye className="h-5 w-5 text-green-500" />
            ) : (
              <EyeOff className="h-5 w-5 text-gray-400" />
            )}
            {t("ocr_form_fill")}
            <Badge
              className={
                enabled
                  ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              }
            >
              {enabled ? t("enable") : t("disable")}
            </Badge>
          </CardTitle>
          <CardDescription>
            {t("ai_vision_settings_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {enabled ? t("plugin_enabled") : t("plugin_disabled")}
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
