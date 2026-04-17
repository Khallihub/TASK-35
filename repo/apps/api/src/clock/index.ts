export interface Clock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
}

export class TestClock implements Clock {
  private _ms: number;

  constructor(initial: Date | number = new Date()) {
    this._ms = typeof initial === 'number' ? initial : initial.getTime();
  }

  now(): Date {
    return new Date(this._ms);
  }

  nowMs(): number {
    return this._ms;
  }

  advance(ms: number): void {
    this._ms += ms;
  }

  set(d: Date): void {
    this._ms = d.getTime();
  }
}

export const systemClock: Clock = new SystemClock();
