export type PlannerActionLease = {
  release: () => void;
};

export class PlannerActionGate {
  #planning = false;

  get planning() {
    return this.#planning;
  }

  get busy() {
    return this.#planning;
  }

  beginPlanning(): PlannerActionLease | null {
    if (this.busy) return null;
    this.#planning = true;
    return this.#lease();
  }

  canApplyCollection() {
    return !this.busy;
  }

  canPublishShare() {
    return !this.busy;
  }

  #lease(): PlannerActionLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#planning = false;
      },
    };
  }
}
