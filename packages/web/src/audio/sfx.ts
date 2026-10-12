// SPDX-License-Identifier: AGPL-3.0-or-later
// Efectos de sonido sintetizados en vivo con WebAudio: ni un solo sample. El arranque es un acorde
// FM propio (nada que ver con el de ninguna consola real).

export type SoundName =
  | 'boot'
  | 'licensed'
  | 'move'
  | 'accept'
  | 'back'
  | 'chip'
  | 'clear'
  | 'error'
  | 'launch'
  | 'bounce'
  | 'settle'
  | 'win'
  | 'bigWin'
  | 'lose'
  | 'jackpot'
  | 'save'
  | 'loan'

type Wave = OscillatorType

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private rollGain: GainNode | null = null
  private rumbleGain: GainNode | null = null
  private muted = false

  /** ¿El navegador ha dejado arrancar el audio? (necesita un gesto del usuario). */
  get running(): boolean {
    return this.ctx?.state === 'running'
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.02)
    }
  }

  /** Crea o reanuda el contexto de audio. Llamar desde un gesto (clic o tecla). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.8
        this.master.connect(this.ctx.destination)
        this.noise = this.makeNoise()
        this.startLoops()
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch (error) {
      console.warn('[audio] no se pudo iniciar WebAudio', error)
    }
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /** Bucles continuos: la bola rodando y el retumbar del cilindro. */
  private startLoops(): void {
    const ctx = this.ctx!
    const roll = ctx.createBufferSource()
    roll.buffer = this.noise
    roll.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    band.Q.value = 0.8
    this.rollGain = ctx.createGain()
    this.rollGain.gain.value = 0
    roll.connect(band).connect(this.rollGain).connect(this.master!)
    roll.start()

    const rumble = ctx.createBufferSource()
    rumble.buffer = this.noise
    rumble.loop = true
    rumble.playbackRate.value = 0.5
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 140
    this.rumbleGain = ctx.createGain()
    this.rumbleGain.gain.value = 0
    rumble.connect(low).connect(this.rumbleGain).connect(this.master!)
    rumble.start()
  }

  /** Intensidad (0–1) del rodar de la bola y del giro del cilindro. */
  setRolling(ball: number, wheel: number): void {
    if (!this.ctx || !this.rollGain || !this.rumbleGain) return
    const t = this.ctx.currentTime
    this.rollGain.gain.setTargetAtTime(Math.max(0, Math.min(1, ball)) * 0.09, t, 0.05)
    this.rumbleGain.gain.setTargetAtTime(Math.max(0, Math.min(1, wheel)) * 0.12, t, 0.1)
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    opts: { wave?: Wave; gain?: number; slideTo?: number; attack?: number } = {},
  ): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.wave ?? 'square'
    osc.frequency.setValueAtTime(freq, start)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur)
    const peak = opts.gain ?? 0.08
    const attack = opts.attack ?? 0.005
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(peak, start + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g).connect(this.master!)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  }

  private burst(start: number, dur: number, freq: number, gain: number, q = 2): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    filter.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, start)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    src.connect(filter).connect(g).connect(this.master!)
    src.start(start, Math.random() * 0.5)
    src.stop(start + dur + 0.02)
  }

  /** Acorde de arranque: osciladores desafinados con filtro que se abre y campanas FM. */
  private bootChord(t: number): void {
    const ctx = this.ctx!
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(220, t)
    filter.frequency.exponentialRampToValueAtTime(5200, t + 1.6)
    filter.Q.value = 3
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.7)
    g.gain.setValueAtTime(0.16, t + 1.8)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4)
    filter.connect(g).connect(this.master!)
    // Re mayor con novena: suena a "algo grande se enciende" sin parecerse a nada conocido.
    for (const f of [73.42, 146.83, 220, 293.66, 369.99, 659.25]) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = f
        osc.detune.value = detune
        osc.connect(filter)
        osc.start(t)
        osc.stop(t + 3.5)
      }
    }
    // Campanas FM descendentes al final del barrido.
    ;[1174.66, 880, 739.99, 587.33].forEach((f, i) => {
      const start = t + 1.1 + i * 0.12
      const car = ctx.createOscillator()
      const mod = ctx.createOscillator()
      const modGain = ctx.createGain()
      const env = ctx.createGain()
      car.frequency.value = f
      mod.frequency.value = f * 3.5
      modGain.gain.setValueAtTime(f * 2, start)
      modGain.gain.exponentialRampToValueAtTime(1, start + 1.2)
      env.gain.setValueAtTime(0.0001, start)
      env.gain.exponentialRampToValueAtTime(0.07, start + 0.01)
      env.gain.exponentialRampToValueAtTime(0.0001, start + 1.6)
      mod.connect(modGain).connect(car.frequency)
      car.connect(env).connect(this.master!)
      car.start(start)
      mod.start(start)
      car.stop(start + 1.7)
      mod.stop(start + 1.7)
    })
    // Golpe grave al principio.
    this.tone(55, t, 0.6, { wave: 'sine', gain: 0.35, slideTo: 30 })
  }

  play(name: SoundName, intensity = 1): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime + 0.005
    switch (name) {
      case 'boot':
        this.bootChord(t)
        return
      case 'licensed':
        this.tone(523.25, t, 0.9, { wave: 'sine', gain: 0.06, attack: 0.05 })
        this.tone(783.99, t + 0.08, 0.9, { wave: 'sine', gain: 0.05, attack: 0.05 })
        return
      case 'move':
        this.tone(1320, t, 0.04, { gain: 0.04 })
        return
      case 'accept':
        this.tone(660, t, 0.06, { gain: 0.05 })
        this.tone(990, t + 0.06, 0.09, { gain: 0.05 })
        return
      case 'back':
        this.tone(520, t, 0.12, { wave: 'triangle', gain: 0.08, slideTo: 300 })
        return
      case 'chip':
        this.burst(t, 0.05, 3200 + Math.random() * 600, 0.5, 3)
        this.tone(2100 + Math.random() * 200, t, 0.03, { wave: 'triangle', gain: 0.05 })
        return
      case 'clear':
        for (let i = 0; i < 4; i++) this.burst(t + i * 0.045, 0.04, 2800 + i * 300, 0.35, 3)
        return
      case 'error':
        this.tone(150, t, 0.16, { gain: 0.07 })
        this.tone(140, t + 0.17, 0.2, { gain: 0.07 })
        return
      case 'launch':
        this.burst(t, 0.35, 1400, 0.25, 0.7)
        return
      case 'bounce':
        this.burst(t, 0.03, 4200, 0.45 * intensity, 4)
        this.tone(2600 + Math.random() * 500, t, 0.02, { wave: 'triangle', gain: 0.05 * intensity })
        return
      case 'settle':
        this.burst(t, 0.06, 3000, 0.4, 3)
        this.tone(180, t, 0.12, { wave: 'sine', gain: 0.12 })
        return
      case 'win':
        ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, t + i * 0.08, 0.14, { gain: 0.06 }),
        )
        return
      case 'bigWin':
        ;[523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          this.tone(f, t + i * 0.09, 0.2, { gain: 0.06 }),
        )
        for (let i = 0; i < 10; i++) {
          this.tone(2000 + Math.random() * 2000, t + 0.6 + i * 0.05, 0.05, {
            wave: 'triangle',
            gain: 0.03,
          })
        }
        return
      case 'lose':
        this.tone(330, t, 0.35, { wave: 'sawtooth', gain: 0.05, slideTo: 300 })
        this.tone(294, t + 0.38, 0.7, { wave: 'sawtooth', gain: 0.05, slideTo: 196 })
        return
      case 'jackpot':
        ;[392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) =>
          this.tone(f, t + i * 0.07, 0.22, { gain: 0.06 }),
        )
        for (let i = 0; i < 24; i++) {
          this.tone(1800 + Math.random() * 2600, t + 0.5 + i * 0.04, 0.04, {
            wave: 'triangle',
            gain: 0.03,
          })
        }
        return
      case 'save':
        this.tone(1760, t, 0.05, { gain: 0.03 })
        this.tone(1760, t + 0.12, 0.05, { gain: 0.03 })
        return
      case 'loan':
        this.tone(2093, t, 0.5, { wave: 'sine', gain: 0.07 })
        this.tone(2637, t, 0.5, { wave: 'sine', gain: 0.05 })
        this.burst(t + 0.05, 0.25, 900, 0.3, 0.6)
        return
    }
  }
}
