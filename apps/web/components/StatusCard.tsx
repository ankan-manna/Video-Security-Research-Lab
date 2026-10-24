"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, MOCK_LAB_BASE_URL } from "@/lib/config";

type ServiceState = "checking" | "online" | "offline";

interface ServiceProbe {
  label: string;
  url: string;
}

const SERVICES: ServiceProbe[] = [
  { label: "api", url: `${API_BASE_URL}/health` },
  { label: "mock-lab", url: `${MOCK_LAB_BASE_URL}/health` },
];

function Dot({ state }: { state: ServiceState }) {
  const color =
    state === "online" ? "bg-lab-accent" : state === "offline" ? "bg-lab-danger" : "bg-lab-warn";
  return <span className={`mr-2 inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function StatusCard() {
  const [states, setStates] = useState<Record<string, ServiceState>>(
    Object.fromEntries(SERVICES.map((service) => [service.label, "checking"])),
  );

  useEffect(() => {
    let cancelled = false;

    async function probe(service: ServiceProbe) {
      try {
        const response = await fetch(service.url, { cache: "no-store" });
        if (!cancelled) {
          setStates((prev) => ({ ...prev, [service.label]: response.ok ? "online" : "offline" }));
        }
      } catch {
        if (!cancelled) {
          setStates((prev) => ({ ...prev, [service.label]: "offline" }));
        }
      }
    }

    SERVICES.forEach(probe);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Service Status</h2>
      <ul className="space-y-2">
        {SERVICES.map((service) => (
          <li key={service.label} className="flex items-center text-xs">
            <Dot state={states[service.label] ?? "checking"} />
            <span className="w-20 text-lab-accent2">{service.label}</span>
            <span className="text-neutral-400">{states[service.label]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
