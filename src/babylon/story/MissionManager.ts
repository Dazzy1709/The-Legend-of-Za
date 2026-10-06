// src/babylon/story/MissionManager.ts
// Runs story mode: which mission is active, which objective is next, and
// what counts toward it. Objectives are completed by listening to what
// happens in the game (talking to someone, resting, riding, defeating
// enemies, reaching a place) on the event bridge — gameplay code never
// needs to know about missions. Finishing a mission pays its rewards,
// plays its cutscene and starts the next one; finishing a chapter (its
// last mission) first waits for the "Mission Passed" moment. The whole
// state goes in the save (exportState/importState).

import type { SaveGame, SavedMissionProgress } from "../../../shared/save";
import { STORY, type MissionDef, type Objective, type TutorialTip } from "../../content/story/missions";
import type { CutsceneId } from "../../content/cutscenes";
import type { EventBridge } from "../core/EventBridge";

/** How long the "Mission Passed" moment (end of a chapter) lasts — the story waits this long before moving on. */
export const MISSION_PASSED_MS = 4800;

/** What the HUD shows about the current mission. */
export interface MissionStatus {
  missionId: string;
  chapter: string;
  title: string;
  objective: string;
  /** "2 / 3" for counted objectives. */
  progress: string | null;
  step: number;
  steps: number;
  /** Tutorial tips for this objective. */
  tips: TutorialTip[];
}

/** What the mission system needs from the rest of the game. */
export interface MissionHost {
  grantXp(amount: number): void;
  grantGold(amount: number): void;
  /** Plays a cutscene, then calls `done` (immediately if it can't be played). */
  playCutscene(id: CutsceneId, done: () => void): void;
  npcPosition(npcId: string): { x: number; z: number } | null;
  safeHousePosition(): { x: number; z: number } | null;
  vehiclePosition(): { x: number; z: number } | null;
}

type StoryState = Omit<SaveGame["story"], "reputation">;

export class MissionManager {
  private missions: Record<string, SavedMissionProgress> = {};
  private activeId: string | null = null;
  private flags = new Set<string>();
  private seenCutscenes = new Set<string>();

  constructor(private bridge: EventBridge, private host: MissionHost) {
    bridge.on("npcInteract", (npcId) => this.progressIf((o) => o.kind === "talk" && o.npcId === npcId));
    bridge.on("safeHouseRested", () => this.progressIf((o) => o.kind === "rest"));
    bridge.on("rideChanged", ({ state }) => {
      if (state === "riding") this.progressIf((o) => o.kind === "ride");
    });
    bridge.on("enemyDied", ({ killedByPlayer }) => {
      if (killedByPlayer) this.progressIf((o) => o.kind === "defeat");
    });
    bridge.on("positionChanged", ({ x, z }) =>
      this.progressIf((o) => o.kind === "goTo" && Math.hypot(x - o.x, z - o.z) <= o.radius)
    );
  }

  /**
   * A new game (nothing started yet): begins the first mission. A loaded
   * game picks up where it was — including a mission cutscene that was cut
   * off (the page refreshed mid-scene), which plays again from its start.
   */
  beginStory() {
    if (Object.keys(this.missions).length === 0 && STORY.length > 0) return this.start(STORY[0]);
    const def = STORY.find((m) => m.id === this.activeId);
    const progress = def ? this.missions[def.id] : undefined;
    if (def && progress?.status === "completed") return this.continueAfter(def);
    if (def && progress?.status === "active" && progress.step === 0 && def.startCutscene && !this.seenCutscenes.has(def.startCutscene)) {
      return this.playCutscene(def.startCutscene, () => this.emitStatus());
    }
    this.emitStatus();
  }

  /** Records a story flag (from a cutscene event, say). */
  addFlag(flag: string) {
    this.flags.add(flag);
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  hasSeenCutscene(id: string): boolean {
    return this.seenCutscenes.has(id);
  }

  markCutsceneSeen(id: string) {
    this.seenCutscenes.add(id);
  }

  /** Where the current objective is, for the minimap — null when it isn't anywhere in particular. */
  getObjectiveMarker(): { x: number; z: number } | null {
    const objective = this.currentObjective();
    if (!objective) return null;
    switch (objective.kind) {
      case "talk":
        return this.host.npcPosition(objective.npcId);
      case "rest":
        return this.host.safeHousePosition();
      case "ride":
        return this.host.vehiclePosition();
      case "goTo":
        return { x: objective.x, z: objective.z };
      case "defeat":
        return objective.marker ?? null;
    }
  }

  getStatus(): MissionStatus | null {
    const def = this.activeDef();
    const p = def && this.missions[def.id];
    const objective = this.currentObjective();
    if (!def || !p || !objective) return null;
    return {
      missionId: def.id,
      chapter: def.chapter,
      title: def.title,
      objective: objective.text,
      progress: objective.kind === "defeat" ? `${p.counter} / ${objective.count}` : null,
      step: p.step,
      steps: def.objectives.length,
      tips: objective.tips ?? [],
    };
  }

  exportState(): StoryState {
    return {
      activeMissionId: this.activeId,
      missions: structuredClone(this.missions),
      flags: [...this.flags],
      seenCutscenes: [...this.seenCutscenes],
    };
  }

  importState(state: StoryState) {
    this.missions = structuredClone(state.missions ?? {});
    this.activeId = state.activeMissionId && STORY.some((m) => m.id === state.activeMissionId) ? state.activeMissionId : null;
    this.flags = new Set(state.flags ?? []);
    this.seenCutscenes = new Set(state.seenCutscenes ?? []);
    // A save from before newer missions were added: carry on with the next unfinished one.
    if (!this.activeId) {
      const next = STORY.find((m) => this.missions[m.id]?.status !== "completed");
      if (next && Object.keys(this.missions).length > 0) {
        this.activeId = next.id;
        this.missions[next.id] ??= { status: "active", step: 0, counter: 0 };
      }
    }
  }

  // ---------- Progress ----------

  private activeDef(): MissionDef | null {
    return STORY.find((m) => m.id === this.activeId) ?? null;
  }

  private currentObjective(): Objective | null {
    const def = this.activeDef();
    const p = def && this.missions[def.id];
    return def && p && p.status === "active" ? def.objectives[p.step] ?? null : null;
  }

  /** Counts something toward the current objective if `matches` it. */
  private progressIf(matches: (objective: Objective) => boolean) {
    const def = this.activeDef();
    const objective = this.currentObjective();
    if (!def || !objective || !matches(objective)) return;
    const p = this.missions[def.id];
    if (objective.kind === "defeat") {
      p.counter++;
      if (p.counter < objective.count) {
        this.emitStatus();
        return;
      }
    }
    p.step++;
    p.counter = 0;
    if (p.step >= def.objectives.length) this.complete(def);
    else {
      this.emitStatus();
      this.bridge.emit("requestSave", { reason: "objective" });
    }
  }

  private start(def: MissionDef) {
    this.activeId = def.id;
    this.missions[def.id] = { status: "active", step: 0, counter: 0 };
    const announce = () => {
      this.emitStatus();
      this.bridge.emit("requestSave", { reason: "mission-start" });
    };
    if (def.startCutscene && !this.seenCutscenes.has(def.startCutscene)) this.playCutscene(def.startCutscene, announce);
    else announce();
  }

  private complete(def: MissionDef) {
    this.missions[def.id] = { status: "completed", step: def.objectives.length, counter: 0 };
    def.setsFlags?.forEach((f) => this.flags.add(f));
    if (def.rewards.xp > 0) this.host.grantXp(def.rewards.xp);
    if (def.rewards.gold > 0) this.host.grantGold(def.rewards.gold);
    const chapter = STORY.filter((m) => m.chapter === def.chapter);
    const chapterEnd = STORY[STORY.indexOf(def) + 1]?.chapter !== def.chapter;
    this.bridge.emit("missionCompleted", {
      title: def.title,
      chapter: def.chapter,
      xp: def.rewards.xp,
      gold: def.rewards.gold,
      chapterEnd,
      chapterXp: chapter.reduce((sum, m) => sum + m.rewards.xp, 0),
      chapterGold: chapter.reduce((sum, m) => sum + m.rewards.gold, 0),
    });
    this.bridge.emit("requestSave", { reason: "mission-complete" });
    if (!chapterEnd) return this.continueAfter(def);
    // The end of a chapter: let "Mission Passed" play out before the next cutscene or mission.
    this.bridge.emit("missionChanged", null); // the tracker clears meanwhile
    setTimeout(() => this.continueAfter(def), MISSION_PASSED_MS);
  }

  /** After a finished mission: its end cutscene (if not seen yet), then the next mission. */
  private continueAfter(def: MissionDef) {
    const next = STORY[STORY.indexOf(def) + 1];
    const continueStory = () => {
      if (next) this.start(next);
      else {
        this.activeId = null;
        this.bridge.emit("missionChanged", null);
        this.bridge.emit("requestSave", { reason: "story-complete" });
      }
    };
    if (def.endCutscene && !this.seenCutscenes.has(def.endCutscene)) this.playCutscene(def.endCutscene, continueStory);
    else continueStory();
  }

  private playCutscene(id: CutsceneId, done: () => void) {
    this.host.playCutscene(id, () => {
      this.seenCutscenes.add(id);
      done();
    });
  }

  private emitStatus() {
    this.bridge.emit("missionChanged", this.getStatus());
  }
}
