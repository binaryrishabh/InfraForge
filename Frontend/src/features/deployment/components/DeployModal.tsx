import { useState } from "react";
import { Modal } from "@/components/UI/Modal";
import {
  INPUT_CLASS,
  LABEL_CLASS,
  CANCEL_BUTTON_CLASS,
  AMBER_BUTTON_CLASS,
  TOGGLE_ACTIVE_CLASS,
  TOGGLE_IDLE_CLASS,
} from "@/theme/controlClasses";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";

interface DeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  resourceCount: number;
  connectionCount: number;
  loading?: boolean;
  onDeploy: (profile: WorkloadProfile, name: string) => void;
}

interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  targetThroughput: number;
  trafficShape: "steady" | "peak";
  peakMultiplier: number;
  readWriteRatio: number;
  payloadSize: "light" | "medium" | "heavy";
}

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "steady-state",
    label: "Steady State",
    description: "Sustained 1M/hr — the architecture's declared design load.",
    targetThroughput: 1_000_000,
    trafficShape: "steady",
    peakMultiplier: 3,
    readWriteRatio: 0.8,
    payloadSize: "medium",
  },
  {
    id: "peak-hours",
    label: "Peak Hours",
    description:
      "1M/hr with 3x burst windows — watch the autoscaler chase the spikes.",
    targetThroughput: 1_000_000,
    trafficShape: "peak",
    peakMultiplier: 3,
    readWriteRatio: 0.8,
    payloadSize: "medium",
  },
  {
    id: "flash-sale",
    label: "Flash Sale",
    description:
      "2M/hr heavy payloads at 5x bursts — bandwidth and DB pressure.",
    targetThroughput: 2_000_000,
    trafficShape: "peak",
    peakMultiplier: 5,
    readWriteRatio: 0.9,
    payloadSize: "heavy",
  },
  {
    id: "bot-attack",
    label: "Bot Attack",
    description: "Sustained 3M/hr of tiny reads — watch everything saturate.",
    targetThroughput: 3_000_000,
    trafficShape: "steady",
    peakMultiplier: 3,
    readWriteRatio: 0.95,
    payloadSize: "light",
  },
  {
    id: "write-storm",
    label: "Write Storm",
    description: "70% writes at 1M/hr — the database takes the beating.",
    targetThroughput: 1_000_000,
    trafficShape: "steady",
    peakMultiplier: 3,
    readWriteRatio: 0.3,
    payloadSize: "medium",
  },
];

export function DeployModal({
  open,
  onOpenChange,
  initialName = "",
  resourceCount,
  connectionCount,
  loading = false,
  onDeploy,
}: DeployModalProps) {
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [targetThroughput, setTargetThroughput] = useState(1_000_000);
  const [throughputUnit, setThroughputUnit] = useState<
    "per-minute" | "per-hour"
  >("per-hour");
  const [trafficShape, setTrafficShape] = useState<"steady" | "peak">("steady");
  const [peakMultiplier, setPeakMultiplier] = useState(3);
  const [readWriteRatio, setReadWriteRatio] = useState(0.8);
  const [payloadSize, setPayloadSize] = useState<"light" | "medium" | "heavy">(
    "medium",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(
    "steady-state",
  );

  const activePresetObj =
    SCENARIO_PRESETS.find((p) => p.id === activePreset) ?? null;
  const divisor = throughputUnit === "per-minute" ? 60 : 3600;
  const rpsPreview =
    targetThroughput > 0 ? Math.round(targetThroughput / divisor) : 0;

  const applyPreset = (preset: ScenarioPreset) => {
    setActivePreset(preset.id);
    setTargetThroughput(preset.targetThroughput);
    setThroughputUnit("per-hour");
    setTrafficShape(preset.trafficShape);
    setPeakMultiplier(preset.peakMultiplier);
    setReadWriteRatio(preset.readWriteRatio);
    setPayloadSize(preset.payloadSize);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Deployment name is required.");
      return;
    }
    if (!targetThroughput || targetThroughput <= 0) return;
    const profile: WorkloadProfile = {
      targetThroughput,
      throughputUnit,
      trafficShape,
      peakMultiplier: trafficShape === "peak" ? peakMultiplier : undefined,
      readWriteRatio,
      payloadSize,
    };
    onDeploy(profile, name.trim());
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Deploy infrastructure"
      description="Name this deployment and declare the load it must survive."
      loading={loading}
    >
      <form onSubmit={handleSubmit}>
        {/* Name box leads the modal — deployments are named artifacts. */}
        <div className="mb-4">
          <label className={LABEL_CLASS}>
            Deployment name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="production-web-cluster"
            maxLength={64}
            disabled={loading}
            className={`${INPUT_CLASS} ${
              nameError
                ? "!border-[#C4574A] !shadow-[0_0_0_3px_rgba(196,87,74,0.16)]"
                : ""
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {nameError && (
            <p className="text-xs text-[#C4574A] mt-1.5">{nameError}</p>
          )}
        </div>
        <p className="font-mono text-xs text-[#5A5F6B] mb-4">
          {resourceCount} resources · {connectionCount} connections
        </p>
        {/* Scenario preset selector */}
        <div className="mb-4">
          <label className={LABEL_CLASS}>
            Scenario preset
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={loading}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed border ${
                  activePreset === preset.id
                    ? `${TOGGLE_ACTIVE_CLASS} border-transparent`
                    : `${TOGGLE_IDLE_CLASS} border-[#2A2E37] hover:border-[#3A3F4A]`
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#5A5F6B] mt-1.5">
            {activePresetObj
              ? activePresetObj.description
              : "Custom profile — tuned by hand."}
          </p>
        </div>
        <div className="mb-4">
          <label className={LABEL_CLASS}>
            Target throughput
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={targetThroughput}
              onChange={(e) => {
                setTargetThroughput(Number(e.target.value));
                setActivePreset(null);
              }}
              disabled={loading}
              className={`flex-1 ${INPUT_CLASS}`}
            />
            <div className="flex rounded-lg border border-[#2A2E37] overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (throughputUnit !== "per-hour") {
                    setThroughputUnit("per-hour");
                    setActivePreset(null);
                  }
                }}
                className={`px-3 text-xs transition-colors duration-150 ${
                  throughputUnit === "per-hour" ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS
                }`}
              >
                /hr
              </button>
              <button
                type="button"
                onClick={() => {
                  if (throughputUnit !== "per-minute") {
                    setThroughputUnit("per-minute");
                    setActivePreset(null);
                  }
                }}
                className={`px-3 text-xs transition-colors duration-150 ${
                  throughputUnit === "per-minute" ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS
                }`}
              >
                /min
              </button>
            </div>
          </div>
          <p className="text-[11px] text-[#5A5F6B] mt-1.5 font-mono">
            ≈ {rpsPreview.toLocaleString()} requests/second at full load
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between text-xs text-[#8B909C] hover:text-[#EDEEF0] py-2 border-t border-[#2A2E37] transition-colors duration-150"
        >
          <span>Advanced workload settings</span>
          <span>{showAdvanced ? "▴" : "▾"}</span>
        </button>
        {showAdvanced && (
          <div className="space-y-4 pt-3">
            <div>
              <label className={LABEL_CLASS}>
                Traffic shape
              </label>
              <div className="flex rounded-lg border border-[#2A2E37] overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    if (trafficShape !== "steady") {
                      setTrafficShape("steady");
                      setActivePreset(null);
                    }
                  }}
                  className={`flex-1 py-1.5 text-xs transition-colors duration-150 ${
                    trafficShape === "steady" ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS
                  }`}
                >
                  Steady
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (trafficShape !== "peak") {
                      setTrafficShape("peak");
                      setActivePreset(null);
                    }
                  }}
                  className={`flex-1 py-1.5 text-xs transition-colors duration-150 ${
                    trafficShape === "peak" ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS
                  }`}
                >
                  Peak
                </button>
              </div>
            </div>
            {trafficShape === "peak" && (
              <div>
                <label className={LABEL_CLASS}>
                  Peak multiplier
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.5}
                  value={peakMultiplier}
                  onChange={(e) => {
                    setPeakMultiplier(Number(e.target.value));
                    setActivePreset(null);
                  }}
                  disabled={loading}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-[#5A5F6B] mt-1">
                  Bursts up to {peakMultiplier}× the base load.
                </p>
              </div>
            )}
            <div>
              <label className={LABEL_CLASS}>
                Read / write mix
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={readWriteRatio * 100}
                onChange={(e) => {
                  setReadWriteRatio(Number(e.target.value) / 100);
                  setActivePreset(null);
                }}
                className="w-full accent-[#4FA89B]"
              />
              <div className="flex justify-between text-[11px] font-mono mt-1">
                <span className="text-[#8B909C]">
                  {Math.round(readWriteRatio * 100)}% reads
                </span>
                <span className="text-[#5A5F6B]">
                  {Math.round((1 - readWriteRatio) * 100)}% writes
                </span>
              </div>
            </div>
            <div>
              <label className={LABEL_CLASS}>
                Payload size
              </label>
              <div className="flex rounded-lg border border-[#2A2E37] overflow-hidden">
                {(["light", "medium", "heavy"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      if (payloadSize !== size) {
                        setPayloadSize(size);
                        setActivePreset(null);
                      }
                    }}
                    className={`flex-1 py-1.5 text-xs capitalize transition-colors duration-150 ${
                      payloadSize === size ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-2 justify-end mt-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className={CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          {/* Deploy is THE single most important action — it owns the amber. */}
          <button
            type="submit"
            disabled={loading || !targetThroughput || targetThroughput <= 0}
            className={AMBER_BUTTON_CLASS}
          >
            {loading && (
              <span className="w-3.5 h-3.5 border-2 border-[#14161A]/30 border-t-[#14161A] rounded-full animate-spin" />
            )}
            Deploy
          </button>
        </div>
      </form>
    </Modal>
  );
}