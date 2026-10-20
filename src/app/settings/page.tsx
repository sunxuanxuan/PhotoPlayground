import { ProviderSettingsPanel } from "@/components/provider-settings-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "后台服务配置 - PlayGround",
  description: "配置背景替换使用的 Ark、YouPai 或 APIMODELS 图片服务。",
};

export default function SettingsPage() {
  return <ProviderSettingsPanel />;
}
