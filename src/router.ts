// router.ts

import { ActorId } from "./actor.js";
import { Event } from "./events.js";

export interface Actor {
  id: ActorId;
  on(event: Event): { effects?: any[] } | void;
}

export class Router {
  private actors = new Map<ActorId, Actor>();
  register(actor: Actor) {
    this.actors.set(actor.id, actor);
  }

  get(id: ActorId): Actor | undefined {
    return this.actors.get(id);
  }

  dispatch(evt: Event) {
    // Some Event variants (e.g. START) do not include a target; ignore them.
    if (!("target" in evt)) return;
    const a = this.actors.get(evt.target as ActorId);
    if (!a) throw new Error(`Actor not found: ${evt.target}`);
    a.on(evt);
  }
}
