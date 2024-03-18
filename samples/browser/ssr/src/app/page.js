"use client"

import useGlean from "./hooks/useGlean";

export default function Home() {
  useGlean();

  return (
    <main>
      <div>Glean SSR Sample Project</div>
    </main>
  );
}
