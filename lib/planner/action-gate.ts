export type PlannerActionLease = {
  release: () => void;
};

export class PlannerActionGate {
  #planning = false;
  #selection = false;

  get planning() {
    return this.#planning;
  }

  get selection() {
    return this.#selection;
  }

  get busy() {
    return this.#planning || this.#selection;
  }

  beginPlanning(): PlannerActionLease | null {
    if (this.busy) return null;
    this.#planning = true;
    return this.#lease("planning");
  }

  beginSelection(): PlannerActionLease | null {
    if (this.busy) return null;
    this.#selection = true;
    return this.#lease("selection");
  }

  canApplyCollection() {
    return !this.busy;
  }

  canPublishShare() {
    return !this.busy;
  }

  #lease(kind: "planning" | "selection"): PlannerActionLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (kind === "planning") this.#planning = false;
        else this.#selection = false;
      },
    };
  }
}
