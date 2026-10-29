import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PersistentUsage } from "./components/persistent-usage.tsx";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "accounts",
    component: PersistentUsage,
  });
});
