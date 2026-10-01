"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { AppConfig } from "@/lib/types";

const DEFAULT_CONFIG: AppConfig = {
  hotelName: "Hotel Management System",
  hotelAddress: "",
  hotelPhone: "",
  hotelEmail: "",
  currency: "USD",
  taxRatePercent: 0,
};

interface ConfigState extends AppConfig {
  money: (value: number | null | undefined) => string;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    api
      .get<AppConfig>("/config")
      .then((res) => setConfig(res.data))
      .catch(() => undefined);
  }, []);

  const value: ConfigState = { ...config, money: (v) => formatMoney(v, config.currency) };
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
