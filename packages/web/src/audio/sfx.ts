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
  /** Menú v2: abrir una pantalla ('accept' + barrido de ruido paso banda 400 → 2400 Hz). */
  | 'menuOpen'
  /** Menú v2: pasar página en CÓMO SE JUEGA (roce de papel, paso banda 2,5 kHz, 120 ms). */
  | 'page'

type Wave = OscillatorType

/**
 * Sonidos de las animaciones de espectáculo (docs/DISENO-V2.md, "Animaciones"). Van aparte de
 * `SoundName` porque algunos reciben un parámetro (`playFx(name, value)`): ver cada caso.
 */
export type FxSoundName =
  | 'impact'
  | 'fanfare'
  | 'fanfareMega'
  /** Tic del contador del premio; `value` 0–1 sube el tono de 1800 a 2600 Hz. */
  | 'countTick'
  | 'winChord'
  | 'bell'
  /** Campanilla de la ventanilla del banco. */
  | 'deskBell'
  | 'greenHi'
  | 'greenLo'
  | 'dingDong'
  | 'boing'
  | 'typeClick'
  | 'deployed'
  | 'rocket'
  | 'stampHit'
  | 'paper'
  /** Garabato de la firma; `value` = duración en segundos. */
  | 'scribble'
  /** Blip de moneda; `value` 0–1 sube el tono de 2 a 4 kHz. */
  | 'coinBlip'
  | 'thud'
  | 'kaching'
  | 'powerDown'
  | 'glitch'
  /** Tic de la cuenta atrás; `value` 1 = los tres últimos (más agudo). */
  | 'countdown'
  | 'fireWhoosh'
  | 'crackle'
  | 'dunDun'
  | 'trophy'
  | 'pendingUp'
  | 'pendingDown'

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private rollGain: GainNode | null = null
  private rumbleGain: GainNode | null = null
  private muted = false
  /** Volumen de 0 a 1 (las barras de Ajustes). */
  private volume = 1

  /** ¿Existe ya el contexto de audio? Solo se crea con el primer gesto del usuario. */
  get started(): boolean {
    return this.ctx !== null
  }

  /** ¿El navegador ha dejado arrancar el audio? (necesita un gesto del usuario). */
  get running(): boolean {
    return this.ctx?.state === 'running'
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyGain()
  }

  /** Volumen general de 0 a 1 (se multiplica por la ganancia de siempre). */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    this.applyGain()
  }

  private masterGain(): number {
    return this.muted ? 0 : 0.8 * this.volume
  }

  private applyGain(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.masterGain(), this.ctx.currentTime, 0.02)
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
        this.master.gain.value = this.masterGain()
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
      case 'menuOpen':
        this.tone(660, t, 0.06, { gain: 0.05 })
        this.tone(990, t + 0.06, 0.09, { gain: 0.05 })
        this.sweep(t, 0.48, 'bandpass', 400, 2400, 0.05)
        return
      case 'page':
        this.burst(t, 0.12, 2500, 0.3, 1.2)
        return
    }
  }

  /** Ruido filtrado con barrido de frecuencia (paso bajo, alto o banda). */
  private sweep(
    start: number,
    dur: number,
    type: BiquadFilterType,
    from: number,
    to: number,
    gain: number,
  ): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(from, start)
    filter.frequency.exponentialRampToValueAtTime(to, start + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, start)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    src.connect(filter).connect(g).connect(this.master!)
    src.start(start)
    src.stop(start + dur + 0.02)
  }

  /** Campana FM (portadora + moduladora con índice que decae). */
  private fmBell(freq: number, start: number, index: number, dur = 1.2, gain = 0.07): void {
    const ctx = this.ctx!
    const car = ctx.createOscillator()
    const mod = ctx.createOscillator()
    const modGain = ctx.createGain()
    const env = ctx.createGain()
    car.frequency.value = freq
    mod.frequency.value = freq * 1.4
    modGain.gain.setValueAtTime(freq * index, start)
    modGain.gain.exponentialRampToValueAtTime(1, start + dur)
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(gain, start + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    mod.connect(modGain).connect(car.frequency)
    car.connect(env).connect(this.master!)
    car.start(start)
    mod.start(start)
    car.stop(start + dur + 0.05)
    mod.stop(start + dur + 0.05)
  }

  /** Nota con vibrato (el acorde final del premio). */
  private vibrato(freq: number, start: number, dur: number, rate: number, gain: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    const g = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    lfo.frequency.value = rate
    depth.gain.value = freq * 0.012
    lfo.connect(depth).connect(osc.frequency)
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01)
    g.gain.setValueAtTime(gain, start + dur * 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g).connect(this.master!)
    osc.start(start)
    lfo.start(start)
    osc.stop(start + dur + 0.02)
    lfo.stop(start + dur + 0.02)
  }

  /** Sonidos del espectáculo. `value` depende del sonido (ver `FxSoundName`). */
  playFx(name: FxSoundName, value = 0): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime + 0.005
    const k = Math.min(1, Math.max(0, value))
    switch (name) {
      case 'impact':
        this.sweep(t, 0.15, 'lowpass', 180, 120, 0.6)
        this.tone(55, t, 0.3, { wave: 'sine', gain: 0.3, slideTo: 30 })
        return
      case 'fanfare':
      case 'fanfareMega':
        ;[523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          this.tone(f, t + i * 0.09, 0.12, { gain: 0.06 }),
        )
        if (name === 'fanfareMega') this.tone(130.81, t, 0.5, { wave: 'sawtooth', gain: 0.06 })
        return
      case 'countTick':
        this.tone(1800 + 800 * k, t, 0.02, { wave: 'triangle', gain: 0.035 })
        return
      case 'winChord':
        for (const f of [1046.5, 1318.5, 1567.98]) this.vibrato(f, t, 0.6, 6, 0.03)
        for (let i = 0; i < 8; i++) {
          this.tone(2000 + Math.random() * 2000, t + 0.08 + i * 0.06, 0.04, {
            wave: 'triangle',
            gain: 0.025,
          })
        }
        return
      case 'bell':
        this.fmBell(1568, t, 3)
        return
      case 'deskBell':
        this.tone(2093, t, 0.3, { wave: 'sine', gain: 0.07 })
        return
      case 'greenHi':
        this.tone(1319, t, 0.12, { wave: 'sine', gain: 0.08 })
        return
      case 'greenLo':
        this.tone(988, t, 0.12, { wave: 'sine', gain: 0.08 })
        return
      case 'dingDong':
        this.tone(1319, t, 0.1, { wave: 'sine', gain: 0.06 })
        this.tone(988, t + 0.09, 0.14, { wave: 'sine', gain: 0.06 })
        return
      case 'boing':
        this.tone(220, t, 0.3, { wave: 'sine', gain: 0.12, slideTo: 110 })
        return
      case 'typeClick':
        this.sweep(t, 0.015, 'highpass', 3000, 3000, 0.25)
        return
      case 'deployed':
        this.tone(880, t, 0.08, { gain: 0.05 })
        this.tone(1320, t, 0.08, { gain: 0.04 })
        return
      case 'rocket':
        this.sweep(t, 0.4, 'lowpass', 300, 2000, 0.4)
        this.tone(80, t, 0.4, { wave: 'sine', gain: 0.2, slideTo: 40 })
        return
      case 'stampHit':
        this.tone(196, t, 0.06, { gain: 0.09 })
        this.burst(t, 0.08, 600, 0.4, 0.7)
        return
      case 'paper':
        this.burst(t, 0.2, 2500, 0.3, 1.2)
        return
      case 'scribble': {
        const dur = Math.max(0.05, value)
        const ctx = this.ctx
        const src = ctx.createBufferSource()
        src.buffer = this.noise
        src.loop = true
        const band = ctx.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.setValueAtTime(1500, t)
        band.frequency.linearRampToValueAtTime(3000, t + dur)
        band.Q.value = 2
        // Modulación a 12 Hz: el rasgueo de la pluma.
        const g = ctx.createGain()
        g.gain.value = 0
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 12
        const depth = ctx.createGain()
        depth.gain.value = 0.18
        lfo.connect(depth).connect(g.gain)
        src.connect(band).connect(g).connect(this.master)
        src.start(t)
        lfo.start(t)
        src.stop(t + dur)
        lfo.stop(t + dur)
        return
      }
      case 'coinBlip':
        this.tone(2000 + 2000 * k, t, 0.03, { wave: 'triangle', gain: 0.04 })
        return
      case 'thud':
        this.tone(90, t, 0.12, { wave: 'sine', gain: 0.3, slideTo: 50 })
        this.burst(t, 0.06, 400, 0.4, 0.7)
        return
      case 'kaching':
        this.play('loan')
        this.fmBell(2093, t + 0.12, 3, 0.9, 0.05)
        return
      case 'powerDown': {
        const ctx = this.ctx
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(440, t)
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.9)
        const low = ctx.createBiquadFilter()
        low.type = 'lowpass'
        low.frequency.setValueAtTime(4000, t)
        low.frequency.exponentialRampToValueAtTime(200, t + 0.9)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.07, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
        osc.connect(low).connect(g).connect(this.master)
        osc.start(t)
        osc.stop(t + 0.95)
        return
      }
      case 'glitch':
        for (let i = 0; i < 4; i++) {
          this.burst(t + i * 0.07, 0.03, 800 + Math.random() * 3000, 0.35, 0.8)
        }
        return
      case 'countdown':
        this.tone(value >= 1 ? 440 : 330, t, 0.05, { gain: 0.06 })
        return
      case 'fireWhoosh':
        this.sweep(t, 0.5, 'lowpass', 400, 3000, 0.35)
        ;[392, 493.88, 587.33, 783.99].forEach((f, i) =>
          this.tone(f, t + i * 0.05, 0.05, { gain: 0.05 }),
        )
        return
      case 'crackle':
        this.burst(t, 0.01, 2500 + Math.random() * 2000, 0.05, 1)
        return
      case 'dunDun':
        this.tone(147, t, 0.2, { wave: 'sawtooth', gain: 0.07 })
        this.tone(139, t + 0.22, 0.2, { wave: 'sawtooth', gain: 0.07 })
        return
      case 'trophy':
        ;[1318.5, 1567.98, 2093].forEach((f, i) =>
          this.tone(f, t + i * 0.07, 0.09, { wave: 'triangle', gain: 0.06 }),
        )
        this.sweep(t + 0.2, 0.2, 'highpass', 6000, 6000, 0.12)
        return
      case 'pendingUp':
        this.tone(1760, t, 0.04, { gain: 0.04 })
        return
      case 'pendingDown':
        this.tone(1320, t, 0.06, { gain: 0.04, slideTo: 880 })
        return
    }
  }
}
