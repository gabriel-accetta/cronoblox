import type { z } from "zod";
import type { RunBudget } from "@cronoblox/agent-core";
import type { Evidence, ModuleStatus, ProfileSnapshot } from "@cronoblox/contracts";

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  required: boolean;
  phase: "core" | "research" | "verification";
  dependencies: readonly string[];
  defaultConfig: Readonly<Record<string, unknown>>;
}

export interface ModuleContext {
  runId: string;
  profile: ProfileSnapshot;
  signal: AbortSignal;
  now(): Date;
  getEvidence(): Promise<Evidence[]>;
  saveRawArtifact(provider: string, key: string, payload: unknown): Promise<void>;
  emit(level: "info" | "warning" | "error", type: string, message: string, data?: Record<string, unknown>): Promise<void>;
  /** Run-wide external-call/cost budget, shared across every agent loop in the run. */
  budget: RunBudget;
  /** Lets an agentic module (e.g. the orchestrator) invoke another registered module as a sub-call. */
  runModule<TInput, TOutput>(id: string, input: TInput): Promise<ModuleResult<TOutput>>;
}

export interface ModuleResult<TOutput> {
  status: ModuleStatus;
  output: TOutput;
  evidence: Evidence[];
  suggested_next_steps: string[];
  warnings: string[];
  metrics: { duration_ms: number; external_calls: number; estimated_cost_usd: number | null };
}

export interface CronobloxModule<TInput, TOutput> {
  manifest: ModuleManifest;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute(input: TInput, context: ModuleContext): Promise<ModuleResult<TOutput>>;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, CronobloxModule<unknown, unknown>>();

  register<TInput, TOutput>(module: CronobloxModule<TInput, TOutput>) {
    if (this.modules.has(module.manifest.id)) throw new Error(`Duplicate module: ${module.manifest.id}`);
    this.modules.set(module.manifest.id, module as CronobloxModule<unknown, unknown>);
    return this;
  }

  get<TInput, TOutput>(id: string): CronobloxModule<TInput, TOutput> {
    const module = this.modules.get(id);
    if (!module) throw new Error(`Module not registered: ${id}`);
    return module as CronobloxModule<TInput, TOutput>;
  }

  list() { return [...this.modules.values()]; }

  assertSelectable(id: string, profile: ProfileSnapshot) {
    const module = this.get(id);
    if (!profile.enabled_modules.includes(id)) throw new Error(`Module ${id} is disabled in profile ${profile.id}`);
    for (const dependency of module.manifest.dependencies) {
      if (!profile.enabled_modules.includes(dependency)) throw new Error(`Module ${id} requires disabled dependency ${dependency}`);
    }
  }
}

export class ModuleRunner {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly persist: (module: ModuleManifest, result: ModuleResult<unknown>) => Promise<void>,
  ) {}

  async run<TInput, TOutput>(id: string, input: TInput, context: ModuleContext): Promise<ModuleResult<TOutput>> {
    this.registry.assertSelectable(id, context.profile);
    const module = this.registry.get<TInput, TOutput>(id);
    const validatedInput = module.inputSchema.parse(input);
    const started = performance.now();
    const result = await module.execute(validatedInput, context);
    const validatedOutput = module.outputSchema.parse(result.output);
    const validated = { ...result, output: validatedOutput, metrics: { ...result.metrics, duration_ms: Math.round(performance.now() - started) } };
    await this.persist(module.manifest, validated);
    return validated;
  }
}
