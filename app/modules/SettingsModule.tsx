"use client";

import type { SettingsModuleProps } from "./settings/types";
import { SettingsModuleView } from "./settings/module-view";
import { useSettingsController } from "./settings/use-settings-controller";

export function SettingsModule(props: SettingsModuleProps = {}) {
  const settings = useSettingsController(props);

  return <SettingsModuleView {...settings} />;
}
