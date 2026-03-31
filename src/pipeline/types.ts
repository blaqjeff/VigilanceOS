export type TargetType = "immunefi" | "github";

export type Target = {
  targetId: string;
  type: TargetType;
  displayName: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type AuditReport = {
  reportId: string;
  targetId: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  affectedSurface?: string[];
  recommendations?: string[];
  poc?: {
    framework: "foundry" | "hardhat";
    text: string;
  };
};

export type ReviewerVerdict = {
  verdict: "publish" | "discard";
  rationale: string;
  confidence: number; // 0..1
};

