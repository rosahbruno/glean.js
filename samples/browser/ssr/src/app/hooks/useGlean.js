"use client";

import { useEffect } from "react";
import Glean from "@mozilla/glean/web";

export default function useGlean() {
  useEffect(() => {
    Glean.setLogPings(true);
    Glean.initialize("ssr-sample", true, {
      maxEvents: 1,
      enableAutoPageLoadEvents: true
    });
  }, []);
}
